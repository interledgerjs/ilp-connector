export interface IStore {
  get (key: string): Promise<string | undefined>
  put (key: string, value: string): Promise<void>
  del (key: string): Promise<void>
}
