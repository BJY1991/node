import { inject, injectable } from 'inversify'
import { Collection, Db } from 'mongodb'
import * as Pino from 'pino'
import { Claim, isClaim, ClaimIdIPFSHashPair } from 'poet-js'

import { childWithFileName } from 'Helpers/Logging'
import { Exchange } from 'Messaging/Messages'
import { Messaging } from 'Messaging/Messaging'

import { IPFS } from './IPFS'

@injectable()
export class ClaimController {
  private readonly logger: Pino.Logger
  private readonly db: Db
  private readonly collection: Collection
  private readonly messaging: Messaging
  private readonly ipfs: IPFS

  constructor(
    @inject('Logger') logger: Pino.Logger,
    @inject('DB') db: Db,
    @inject('Messaging') messaging: Messaging,
    @inject('IPFS') ipfs: IPFS
  ) {
    this.logger = childWithFileName(logger, __filename)
    this.db = db
    this.collection = this.db.collection('storage')
    this.messaging = messaging
    this.ipfs = ipfs
  }

  async create(claim: Claim): Promise<void> {
    const logger = this.logger.child({ method: 'create' })

    logger.trace({ claim }, 'Storing Claim')

    const ipfsHash = await this.ipfs.addText(JSON.stringify(claim))

    logger.info({ claim, ipfsHash }, 'Claim Stored')

    await this.collection.insertOne({
      claimId: claim.id,
      ipfsHash
    })
    await this.messaging.publish(Exchange.ClaimIPFSHash, {
      claimId: claim.id,
      ipfsHash
    })
  }

  async download(ipfsHashes: ReadonlyArray<string>) {
    const logger = this.logger.child({ method: 'download' })

    logger.trace({ ipfsHashes }, 'Downloading Claims')
    try {
      await this.collection.insertMany(
        ipfsHashes.map(ipfsHash => ({ ipfsHash, claimId: null, lastDownloadAttempt: null, lastDownloadSuccess: null })),
        { ordered: false }
      )
    } catch (e) {
      logger.info('error inserting many')
    }
  }

  async handleHashDownload(ipfsHash: string) {
    const logger = this.logger.child({ method: 'handleHashDownload' });
    logger.info('downloading', ipfsHash)

    try {
      logger.trace({ ipfsHash }, 'Downloading Next Hash')
      const claim = await this.downloadClaim(ipfsHash)
      logger.info('Successfully downloaded claim from IPFS');
      logger.info({ ipfsHash, claim }, 'Successfully downloaded claim from IPFS')
      await this.updateClaimIdIPFSHashPairs([
        {
          claimId: claim.id,
          ipfsHash
        }
      ])

      await this.messaging.publishClaimsDownloaded([
        {
          claim,
          ipfsHash
        }
      ])
    } catch (exception) {
      logger.info('failed to download claim');
      logger.debug({ ipfsHash, exception }, 'Failed to Download Claim')
    }
  }

  async downloadNextHash({
    currentTime = new Date().getTime(),
    downloadDelay = 600000
  } = {}) {
    const logger = this.logger.child({ method: 'downloadNextHash' })

    logger.trace('Downloading Next Hash')
    let record;

    try {

      
      record = await this.collection.findOne({
        claimId: null,
        ipfsHash: { $exists: true },
        $and: [
          {
            $or: [
              { lastDownloadAttempt: null },
              { lastDownloadAttempt: { $exists: false } },
              { lastDownloadAttempt: { $lt: currentTime - downloadDelay } },
            ]
          },
          {
            $or: [
              { lastDownloadSuccess: null },
              { lastDownloadSuccess: { $exists: false } }
            ]
          }
        ]
      });
    } catch(e) {
      logger.info('failed to find a downloadable record');
    }

    if (!record) {
      logger.info('no downloadable records found');
      return;
    }

    logger.info(record);
    try {
    await this.collection.updateOne({
      _id: record._id
    }, {
      $set: { lastDownloadAttempt: currentTime }
    });
  } catch(e) {
    logger.info('failed to update lastDownloadAttempt');
  }

    this.handleHashDownload(record.ipfsHash);
    

    // await this.collection.findOneAndUpdate({
    //   claimId: null,
    //   lastDownloadSuccess: { $exists: false },
    //   ipfsHash: { $exists: true },
    //   $or: [
    //     { lastDownloadAttempt: { $lt: currentTime - downloadDelay } },
    //     { lastDownloadAttempt: { $exists: false } }
    //   ]
    // }, {
    //   lastDownloadAttempt: currentTime
    // },
    // (error, result) => {
    //   logger.info(error, result);
    //   if (error) return;
    //   if (!result) return;
    //   if (!result.value) return;
    //   if (!result.value.ipfsHash) return;
    //   
    // })    
  }

  private downloadClaim = async (ipfsHash: string): Promise<Claim> => {
    const text = await this.ipfs.cat(ipfsHash)
    const claim = JSON.parse(text)

    if (!isClaim(claim)) throw new Error('Unrecognized claim')

    return claim
  }

  private async updateClaimIdIPFSHashPairs(
    claimIdIPFSHashPairs: ReadonlyArray<ClaimIdIPFSHashPair>
  ) {
    const logger = this.logger.child({ method: 'updateClaimIdIPFSHashPairs' })

    logger.trace(
      { claimIdIPFSHashPairs },
      'Storing { claimId, ipfsHash } pairs in the DB.'
    )

    const results = await Promise.all(
      claimIdIPFSHashPairs.map(({ claimId, ipfsHash }) =>
        this.collection.updateOne(
          { ipfsHash },
          { $set: { claimId } },
          { upsert: true }
        )
      )
    )

    const databaseErrors = results.filter(_ => _.result.n !== 1)

    if (databaseErrors.length)
      logger.error(
        { databaseErrors },
        'Error storing { claimId, ipfsHash } pairs in the DB.'
      )

    logger.trace(
      { claimIdIPFSHashPairs },
      'Storing { claimId, ipfsHash } pairs in the DB successfully.'
    )
  }
}
