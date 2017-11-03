import * as FormData from 'form-data'
import fetch from 'node-fetch'
import str from 'string-to-stream'

/**
 * Wrapper around IPFS' RPC
 */
export class IPFS {
  private readonly url: string

  constructor(url: string) {
    this.url = url
  }

  cat = async (hash: string): Promise<string> =>  {
    const response = await fetch(`${this.url}/api/v0/cat?arg=${hash}`)
    return response.text()
  }

  addText = async (text: string): Promise<string> => {
    const formData = new FormData() // { maxDataSize: 20971520 }

    formData.append('file', str(text), {
      knownLength: text.length,
      filename: 'file',
      contentType: 'plain/text'
    })

    const response = await fetch(`${this.url}/api/v0/add`, {
      method: 'post',
      body: formData
    })

    const json = await response.json()

    return json.Hash
  }

}
