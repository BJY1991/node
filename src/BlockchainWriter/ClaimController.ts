import * as bitcore from 'bitcore-lib'
import { inject, injectable } from 'inversify'
import { Collection, Db } from 'mongodb'

import { Exchange } from 'Messaging/Messages'
import { Messaging } from 'Messaging/Messaging'

import { InsightHelper } from 'Helpers/Insight'
import { ClaimControllerConfiguration } from './ClaimControllerConfiguration'

@injectable()
export class ClaimController {
  private readonly db: Db
  private readonly collection: Collection
  private readonly messaging: Messaging
  private readonly insightHelper: InsightHelper
  private readonly configuration: ClaimControllerConfiguration

  constructor(
    @inject('DB') db: Db,
    @inject('Messaging') messaging: Messaging,
    @inject('InsightHelper') insightHelper: InsightHelper,
    @inject('ClaimControllerConfiguration') configuration: ClaimControllerConfiguration,
  ) {
    if (!configuration.bitcoinAddress)
      throw new Error('configuration.bitcoinAddress is required.')
    if (!configuration.bitcoinAddressPrivateKey)
      throw new Error('configuration.bitcoinAddressPrivateKey is required.')

    this.db = db
    this.messaging = messaging
    this.insightHelper = insightHelper
    this.configuration = configuration
    this.collection = this.db.collection('blockchainWriter')
  }

  async timestamp(ipfsHash: string): Promise<void> {
    console.log(`BlockchainWriter.ClaimController.timestamp(${ipfsHash})`)

    const utxo = await this.insightHelper.getUtxo(this.configuration.bitcoinAddress)

    if (!utxo || !utxo.length)
      throw new Error(`Wallet seems to be empty. Check funds for ${this.configuration.bitcoinAddress}`)

    // Use only up to 5 unused outputs to avoid large transactions, picking the ones with the most satoshis to ensure enough fee
    const topUtxo = utxo.slice().sort((a, b) => b.satoshis - a.satoshis).slice(0, 5)

    console.log(JSON.stringify({
      message: 'Got UTXO from Insight',
      address: this.configuration.bitcoinAddress,
      utxo
    }, null, 2))

    const data = Buffer.concat([
      Buffer.from(this.configuration.poetNetwork),
      Buffer.from([...this.configuration.poetVersion]),
      Buffer.from(ipfsHash)
    ])
    const tx = new bitcore.Transaction()
      .from(topUtxo)
      .change(this.configuration.bitcoinAddress)
      .addData(data)
      .sign(this.configuration.bitcoinAddressPrivateKey)

    console.log('\nBitcoin transaction hash is', tx.hash)

    const txPostResponse = await this.insightHelper.broadcastTx(tx)

    console.log('\nBroadcasted Tx:', txPostResponse)

    this.collection.insertOne({
      ipfsHash,
      txId: tx.id
    })
    this.messaging.publish(Exchange.IPFSHashTxId, {
      ipfsHash,
      txId: tx.id
    })
    console.log(`BlockchainWriter.ClaimController.timestamp, created ${tx.id}`)
  }
}
