import { spy, spies, SpyImpl } from './spy'
import { assert, isType } from './utils'

type Procedure = (...args: any[]) => any

type Methods<T> = {
  [K in keyof T]: T[K] extends Procedure ? K : never
}[keyof T] &
  string
type Getters<T> = {
  [K in keyof T]: T[K] extends Procedure ? never : K
}[keyof T] &
  string
type Classes<T> = {
  [K in keyof T]: T[K] extends new (...args: any[]) => any ? K : never
}[keyof T] &
  string

let getDescriptor = (obj: any, method: string) =>
  Object.getOwnPropertyDescriptor(obj, method)

// setters exist without getter, so we can check only getters
export function spyOn<T, S extends Getters<Required<T>>>(
  obj: T,
  methodName: { setter: S },
  mock?: (arg: T[S]) => void
): SpyImpl<[T[S]], void>
export function spyOn<T, G extends Getters<Required<T>>>(
  obj: T,
  methodName: { getter: G },
  mock?: () => T[G]
): SpyImpl<[], T[G]>
export function spyOn<T, M extends Classes<Required<T>>>(
  object: T,
  method: M
): Required<T>[M] extends new (...args: infer A) => infer R
  ? SpyImpl<A, R>
  : never
export function spyOn<T, M extends Methods<Required<T>>>(
  obj: T,
  methodName: M,
  mock?: T[M]
): Required<T>[M] extends (...args: infer A) => infer R ? SpyImpl<A, R> : never
export function spyOn<T, K extends string & keyof T>(
  obj: T,
  methodName: K | { getter: K } | { setter: K },
  mock?: Procedure
): SpyImpl<any[], any> {
  assert(
    !isType('undefined', obj),
    'spyOn could not find an object to spy upon'
  )

  assert(
    isType('object', obj) || isType('function', obj),
    'cannot spyOn on a primitive value'
  )

  let getMeta = (): [string, 'value' | 'get' | 'set'] => {
    if (typeof methodName === 'string') {
      return [methodName, 'value']
    }
    if ('getter' in methodName) {
      return [methodName.getter, 'get']
    }
    return [methodName.setter, 'set']
  }

  let [accessName, accessType] = getMeta()
  let objDescriptor = getDescriptor(obj, accessName)
  let proto = Object.getPrototypeOf(obj)
  let protoDescriptor = proto && getDescriptor(proto, accessName)
  let descriptor = objDescriptor || protoDescriptor

  assert(descriptor || accessName in obj, `${accessName} does not exist`)

  let ssr = false

  // vite ssr support - actual function is stored inside a getter
  if (
    accessType === 'value' &&
    descriptor &&
    !descriptor.value &&
    descriptor.get
  ) {
    accessType = 'get'
    ssr = true
    mock = descriptor.get!()
  }

  let origin: Procedure

  if (descriptor) {
    origin = descriptor[accessType]
  } else if (accessType !== 'value') {
    origin = () => obj[accessName as keyof T]
  } else {
    origin = obj[accessName as keyof T] as unknown as Procedure
  }

  if (!mock) mock = origin

  let fn = spy(mock) as unknown as SpyImpl
  let define = (cb: any) => {
    let { value, ...desc } = descriptor || {
      configurable: true,
      writable: true,
    }
    if (accessType !== 'value') {
      delete desc.writable // getter/setter can't have writable attribute at all
    }
    ;(desc as PropertyDescriptor)[accessType] = cb
    Object.defineProperty(obj, accessName, desc)
  }
  let restore = () => define(origin)
  fn.restore = restore
  fn.getOriginal = () => (ssr ? origin() : origin)
  fn.willCall = (newCb: Procedure) => {
    fn.impl = newCb
    return fn
  }

  define(ssr ? () => fn : fn)

  spies.add(fn)
  return fn
}
