import { injectable, inject } from 'inversify'
import * as Koa from 'koa'
import * as KoaBody from 'koa-body'
import * as KoaRouter from 'koa-router'

import { isClaim, isValidSignature } from '../Helpers/Claim'
import { ClaimType } from '../Interfaces'
import { IllegalArgumentException } from './Exceptions'
import { HttpExceptionsMiddleware } from './HttpExceptionsMiddleware'
import { RouterConfiguration } from './RouterConfiguration'
import { WorkController } from './WorkController'

@injectable()
export class Router {
  private readonly configuration: RouterConfiguration
  private readonly koa = new Koa()
  private readonly koaRouter = new KoaRouter()
  private readonly workController: WorkController

  constructor(
    @inject('RouterConfiguration') configuration: RouterConfiguration,
    @inject('WorkController') workController: WorkController)
  {
    this.configuration = configuration
    this.workController = workController

    this.koaRouter.get('/works/:id', this.getWork)
    this.koaRouter.post('/works', this.postWork)

    this.koa.use(HttpExceptionsMiddleware)
    this.koa.use(KoaBody({ textLimit: 1000000 }))
    this.koa.use(this.koaRouter.allowedMethods())
    this.koa.use(this.koaRouter.routes())
  }

  async start() {
    console.log('API Loaded Configuration', this.configuration)
    this.koa.listen(this.configuration.port, '0.0.0.0')
  }

  private getWork = async (context: KoaRouter.IRouterContext, next: () => Promise<any>) => {
    const id = context.params.id
    const work = await this.workController.getById(id)
    context.body = work
  }

  private postWork = (context: KoaRouter.IRouterContext, next: () => Promise<any>) => {
    const work = context.request.body

    if (!isClaim(work))
      throw new IllegalArgumentException('Request Body must be a Claim.')

    if (!isValidSignature(work))
      throw new IllegalArgumentException('Claim\'s signature is incorrect.')

    if (work.type !== ClaimType.Work)
      throw new IllegalArgumentException('Claim\'s type must be WORK.')

    this.workController.create(work)
  }
}
