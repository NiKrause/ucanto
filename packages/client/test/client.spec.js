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
