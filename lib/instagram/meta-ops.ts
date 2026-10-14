import {
  getInstagramSubscribedFields,
  refreshLongLivedToken,
  subscribeInstagramAccountToWebhooks,
} from "@/lib/meta/client";
import type { MetaOps } from "@/lib/instagram/maintenance";

/** Production wiring: the real Meta calls behind the maintenance service. */
export const liveMetaOps: MetaOps = {
  refreshToken: refreshLongLivedToken,
  getSubscribedFields: getInstagramSubscribedFields,
  subscribe: subscribeInstagramAccountToWebhooks,
};
