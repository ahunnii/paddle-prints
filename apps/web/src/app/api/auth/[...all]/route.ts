import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@paddle-prints/auth";

export const { GET, POST } = toNextJsHandler(auth);
