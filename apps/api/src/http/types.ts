export interface AuthContext {
  tenantId: string;
  userId: string;
  role: "user" | "admin";
  plan: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
