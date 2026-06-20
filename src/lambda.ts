import awsLambdaFastify, { type PromiseHandler } from '@fastify/aws-lambda'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda'
import { buildApp } from './app.js'

type Proxy = PromiseHandler<APIGatewayProxyEventV2, APIGatewayProxyResultV2>

/**
 * Lambda entry point. The Fastify app is built once per warm container and the
 * proxy is reused across invocations to avoid rebuilding on every request.
 */
let proxyPromise: Promise<Proxy> | undefined

async function createProxy(): Promise<Proxy> {
  const app = await buildApp()
  return awsLambdaFastify(app)
}

export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  proxyPromise ??= createProxy()
  const proxy = await proxyPromise
  return proxy(event, context)
}
