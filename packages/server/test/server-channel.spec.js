import * as Client from '@ucanto/client'
import * as Server from '../src/lib.js'
import * as CAR from '@ucanto/transport/car'
import { Codec } from '@ucanto/transport'
import * as CBOR from '@ucanto/core/cbor'
import { Schema } from '@ucanto/core'
import * as Service from '../../client/test/service.js'
import { alice, bob, service as w3 } from './fixtures.js'
import { test, assert } from './test.js'

const service = Service.create()

const storeAddCapability = Server.capability({
  can: 'store/add',
  with: Server.URI.match({ protocol: 'did:' }),
  nb: Schema.struct({
    link: Server.Link.match().optional(),
  }),
  derives: (claimed, delegated) => {
    if (claimed.with !== delegated.with) {
      return Server.fail(
        `Expected 'with: "${delegated.with}"' instead got '${claimed.with}'`
      )
    } else if (
      delegated.nb.link &&
      `${delegated.nb.link}` !== `${claimed.nb.link}`
    ) {
      return Server.fail(
        `Link ${
          claimed.nb.link == null ? '' : `${claimed.nb.link} `
        }violates imposed ${delegated.nb.link} constraint`
      )
    } else {
      return Server.ok({})
    }
  },
})

const storeRemoveCapability = Server.capability({
  can: 'store/remove',
  with: Server.URI.match({ protocol: 'did:' }),
  nb: Schema.struct({
    link: Server.Link.match().optional(),
  }),
  derives: (claimed, delegated) => {
    if (claimed.with !== delegated.with) {
      return Server.fail(
        `Expected 'with: "${delegated.with}"' instead got '${claimed.with}'`
      )
    } else if (
      delegated.nb.link &&
      `${delegated.nb.link}` !== `${claimed.nb.link}`
    ) {
      return Server.fail(
        `Link ${
          claimed.nb.link == null ? '' : `${claimed.nb.link} `
        }violates imposed ${delegated.nb.link} constraint`
      )
    } else {
      return Server.ok({})
    }
  },
})

const server = Server.create({
  id: w3,
  service: {
    store: {
      add: Server.provide(storeAddCapability, async ({ invocation }) =>
        service.store.add(/** @type {Client.Invocation<any>} */ (invocation))
      ),
      remove: Server.provide(storeRemoveCapability, async ({ invocation }) =>
        service.store.remove(/** @type {Client.Invocation<any>} */ (invocation))
      ),
    },
  },
  codec: CAR.inbound,
  validateAuthorization: () => ({ ok: {} }),
})

/**
 * @typedef {{
 *   store: {
 *     add: Client.ServiceMethod<any, any, any>
 *     remove: Client.ServiceMethod<any, any, any>
 *   }
 * }} StoreService
 */

/** @type {Client.ConnectionView<StoreService>} */
const connection = Client.connect({
  id: w3,
  channel: server,
  codec: CAR.outbound,
})

test('execute with server as channel', async () => {
  const car = await CAR.codec.write({
    roots: [await CBOR.write({ hello: 'world ' })],
  })

  const add = Client.invoke({
    issuer: alice,
    audience: w3,
    capability: {
      can: 'store/add',
      with: alice.did(),
      nb: { link: car.cid },
    },
    proofs: [],
  })

  const e1 = await add.execute(connection)

  assert.deepEqual(e1.out, {
    error: {
      name: 'UnknownDIDError',
      message: `DID ${alice.did()} has no account`,
      did: alice.did(),
    },
  })

  service.access.accounts.register(
    alice.did(),
    'did:email:alice@web.mail',
    car.cid
  )

  const [r1] = await connection.execute(add)
  assert.deepEqual(r1.out, {
    ok: {
      with: alice.did(),
      link: car.cid,
      status: 'upload',
      url: 'http://localhost:9090/',
    },
  })
})

test('execute with delegations and server as channel', async () => {
  const car = await CAR.codec.write({
    roots: [await CBOR.write({ hello: 'world ' })],
  })

  const add = Client.invoke({
    issuer: bob,
    audience: w3,
    capability: {
      can: 'store/add',
      with: bob.did(),
      nb: { link: car.cid },
    },
    proofs: [],
  })

  const [e1] = await connection.execute(await add.delegate())

  assert.deepEqual(e1.out, {
    error: {
      name: 'UnknownDIDError',
      message: `DID ${bob.did()} has no account`,
      did: bob.did(),
    },
  })

  service.access.accounts.register(bob.did(), 'did:email:bob@web.mail', car.cid)

  const [r1] = await connection.execute(await add.delegate())
  assert.deepEqual(r1.out, {
    ok: {
      with: bob.did(),
      link: car.cid,
      status: 'upload',
      url: 'http://localhost:9090/',
    },
  })
})

test('decode error with server as channel', async () => {
  const client = Client.connect({
    id: w3,
    channel: server,
    codec: Codec.outbound({
      encoders: {
        'application/car': CAR.request,
      },
      decoders: {
        'application/car+receipt': CAR.response,
      },
    }),
  })

  const car = await CAR.codec.write({
    roots: [await CBOR.write({ hello: 'world ' })],
  })

  const add = Client.invoke({
    issuer: alice,
    audience: w3,
    capability: {
      can: 'store/add',
      with: alice.did(),
      nb: { link: car.cid },
    },
    proofs: [],
  })

  const [e1] = await client.execute(await add.delegate())

  assert.deepEqual(
    {
      error: {
        message:
          "Can not decode response with content-type 'application/vnd.ipld.car' because no matching transport decoder is configured.",
        // @ts-expect-error
        name: 'TypeError',
        error: true,
      },
    },
    e1.out
  )
})
