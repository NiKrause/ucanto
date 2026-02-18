import { test, assert } from './test.js'
import * as Client from '../src/lib.js'
import * as HTTP from '@ucanto/transport/http'
import { CAR, Codec } from '@ucanto/transport'
import * as Service from './service.js'
import { Receipt, Message, CBOR } from '@ucanto/core'
import { alice, bob, mallory, service as w3 } from './fixtures.js'
import fetch from '@web-std/fetch'

test('encode invocation', async () => {
  /** @type {Client.ConnectionView<Service.Service>} */
  const connection = Client.connect({
    id: w3,
    channel: HTTP.open({ url: new URL('about:blank'), fetch }),
    codec: CAR.outbound,
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

  const message = await Message.build({ invocations: [add] })
  const payload = await connection.codec.encode(message)

  assert.deepEqual(payload.headers, {
    'content-type': 'application/vnd.ipld.car',
    accept: 'application/vnd.ipld.car',
  })
  assert.ok(payload.body instanceof Uint8Array)

  const request = await CAR.request.decode(payload)

  const [invocation] = request.invocations
  assert.equal(request.invocations.length, 1)
  assert.equal(invocation.issuer.did(), alice.did())
  assert.equal(invocation.audience.did(), w3.did())
  assert.deepEqual(invocation.proofs, [])
  assert.deepEqual(invocation.capabilities, [
    {
      can: 'store/add',
      with: alice.did(),
      nb: { link: car.cid },
    },
  ])
})

test('encode delegated invocation', async () => {
  const car = await CAR.codec.write({
    roots: [await CBOR.write({ hello: 'world ' })],
  })

  /** @type {Client.ConnectionView<Service.Service>} */
  const connection = Client.connect({
    id: w3,
    channel: HTTP.open({ url: new URL('about:blank'), fetch }),
    codec: CAR.outbound,
  })

  const proof = await Client.delegate({
    issuer: alice,
    audience: bob,
    capabilities: [
      {
        can: 'store/add',
        with: alice.did(),
      },
    ],
  })

  const add = Client.invoke({
    issuer: bob,
    audience: w3,
    capability: {
      can: 'store/add',
      with: alice.did(),
      nb: { link: car.cid },
    },
    proofs: [proof],
  })

  const remove = Client.invoke({
    issuer: alice,
    audience: w3,
    capability: {
      can: 'store/remove',
      with: alice.did(),
      link: car.cid,
    },
  })

  const message = await Message.build({ invocations: [add, remove] })
  const payload = await connection.codec.encode(message)
  const request = await CAR.request.decode(payload)
  {
    const [add, remove] = request.invocations
    assert.equal(request.invocations.length, 2)

    assert.equal(add.issuer.did(), bob.did())
    assert.equal(add.audience.did(), w3.did())
    assert.deepEqual(add.capabilities, [
      {
        can: 'store/add',
        with: alice.did(),
        nb: { link: car.cid },
      },
    ])

    assert.deepEqual(add.proofs, [proof])
    const delegation = /** @type {Client.Delegation} */ (
      add.proofs && add.proofs[0]
    )
    assert.equal(delegation.issuer.did(), proof.issuer.did())
    assert.equal(delegation.audience.did(), proof.audience.did())
    assert.deepEqual(delegation.capabilities, proof.capabilities)

    assert.equal(remove.issuer.did(), alice.did())
    assert.equal(remove.audience.did(), w3.did())
    assert.deepEqual(remove.proofs, [])
    assert.deepEqual(
      [
        Object({
          can: 'store/remove',
          with: alice.did(),
          link: car.cid,
        }),
      ],
      remove.capabilities
    )
  }
})

test('execute invocation', async () => {
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

  const channel = {
    request: async (/** @type {any} */ input) => {
      const { invocations } = await CAR.request.decode(input)
      const receipts = await Promise.all(
        invocations.map(invocation =>
          Receipt.issue({
            ran: invocation.cid,
            issuer: w3,
            result: {
              ok: {
                with: invocation.capabilities[0].with,
                link: car.cid,
                status: 'upload',
                url: 'http://localhost:9090/',
              },
            },
          })
        )
      )
      const message = await Message.build({
        receipts: /** @type {any} */ (receipts),
      })
      return CAR.response.encode(message)
    },
  }

  const connection = Client.connect({
    id: w3,
    channel: /** @type {any} */ (channel),
    codec: CAR.outbound,
  })

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

test('decode error', async () => {
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

  const channel = {
    request: async (/** @type {any} */ input) => {
      const { invocations } = await CAR.request.decode(input)
      const receipts = await Promise.all(
        invocations.map(invocation =>
          Receipt.issue({
            ran: invocation.cid,
            issuer: w3,
            result: { ok: {} },
          })
        )
      )
      const message = await Message.build({
        receipts: /** @type {any} */ (receipts),
      })
      return CAR.response.encode(message)
    },
  }

  const client = Client.connect({
    id: w3,
    channel: /** @type {any} */ (channel),
    codec: Codec.outbound({
      encoders: {
        'application/car': CAR.request,
      },
      decoders: {
        'application/car+receipt': CAR.response,
      },
    }),
  })

  const [e1] = await client.execute(add)

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
