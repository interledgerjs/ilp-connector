import { Pipeline, PipelineEntry, MiddlewareMethod } from '../types/middleware'
import { create as createLogger } from '../common/log'
const log = createLogger('middleware-pipeline')

export default class MiddlewarePipeline<T,U> implements Pipeline<T,U> {
  private entries: PipelineEntry<T,U>[] = []

  insertFirst (entry: PipelineEntry<T,U>) {
    this.entries = [entry, ...this.entries]
  }

  insertLast (entry: PipelineEntry<T,U>) {
    this.entries = [...this.entries, entry]
  }

  insertBefore (middlewareName: string, entry: PipelineEntry<T,U>) {
    const pipelineNames = this.entries.map((m: PipelineEntry<T,U>) => m.name)
    const index = pipelineNames.indexOf(middlewareName)

    if (index === -1) {
      throw new Error(`could not insert before middleware; not found. name=${middlewareName}`)
    }

    this.entries = [
      ...this.entries.slice(0, index),
      entry,
      ...this.entries.slice(index)
    ]
  }

  insertAfter (middlewareName: string, entry: PipelineEntry<T,U>) {
    const pipelineNames = this.entries.map((m: PipelineEntry<T,U>) => m.name)
    const index = pipelineNames.indexOf(middlewareName)

    if (index === -1) {
      throw new Error(`could not insert after middleware; not found. name=${middlewareName}`)
    }

    this.entries = [
      ...this.entries.slice(0, index + 1),
      entry,
      ...this.entries.slice(index + 1)
    ]
  }

  compose (): MiddlewareMethod<T, U> {
    return (val: T, next: MiddlewareMethod<T, U>) => {
      // last called middleware #
      let index = -1

      const dispatch = async (i: number, val: T): Promise<U> => {
        if (i <= index) {
          throw new Error('next() called multiple times.')
        }
        index = i
        const fn = (i === this.entries.length) ? next : this.entries[i].method

        if (i < this.entries.length) {
          log.debug('running middleware step. name=%s', this.entries[i].name)
        }

        return fn(val, function next (val: T) {
          return dispatch(i + 1, val)
        })
      }

      return dispatch(0, val)
    }
  }
}
