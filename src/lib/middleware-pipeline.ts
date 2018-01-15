import { Pipeline, PipelineEntry, MiddlewareMethod } from '../types/middleware'

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

  getMethods () {
    return this.entries.map(e => e.method)
  }
}
