import { request } from "http";
import { IlpPrepare, IlpReply } from "ilp-packet";

export type RequestHandler = (request: IlpPrepare) => Promise<IlpReply>

export interface Router {
  addPeer: (name: string, handler: RequestHandler) => void,
  removePeer: (name: string) => void,
  request: (ilpPrepare: IlpPrepare) => Promise<IlpReply>,
  setAddress:(address: string) => void
}