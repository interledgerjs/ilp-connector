export interface StoreServices {

}

export interface StoreConstructor {
  new (options: object, api: StoreServices): StoreInstance
}

export interface StoreInstance {
  get (key: string): Promise<string | undefined>
  put (key: string, value: string): Promise<void>
  del (key: string): Promise<void>
}
