import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '../../shared/database/client.js'
import {
  type AuthToken,
  type AuthTokenType,
  authTokens,
  type RefreshToken,
  refreshTokens,
  type User,
  users,
} from '../../shared/database/schema.js'

export interface AuthRepository {
  findUserByEmail(email: string): Promise<User | undefined>
  findUserById(id: string): Promise<User | undefined>
  createUser(email: string, name: string, passwordHash: string): Promise<User>
  updateName(userId: string, name: string): Promise<User | undefined>
  setEmailVerified(userId: string): Promise<void>
  updatePassword(userId: string, passwordHash: string): Promise<void>
  createAuthToken(userId: string, tokenHash: string, type: AuthTokenType, expiresAt: Date): Promise<void>
  findActiveAuthToken(tokenHash: string, type: AuthTokenType): Promise<AuthToken | undefined>
  markAuthTokenUsed(id: string): Promise<void>
  createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | undefined>
  revokeRefreshToken(id: string): Promise<void>
  revokeAllRefreshTokens(userId: string): Promise<void>
}

export function createAuthRepository(db: Database): AuthRepository {
  return {
    async findUserByEmail(email): Promise<User | undefined> {
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
      return rows[0]
    },
    async findUserById(id): Promise<User | undefined> {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
      return rows[0]
    },
    async createUser(email, name, passwordHash): Promise<User> {
      const rows = await db.insert(users).values({ email, name, passwordHash }).returning()
      return rows[0]
    },
    async updateName(userId, name): Promise<User | undefined> {
      const rows = await db
        .update(users)
        .set({ name, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning()
      return rows[0]
    },
    async setEmailVerified(userId): Promise<void> {
      await db.update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, userId))
    },
    async updatePassword(userId, passwordHash): Promise<void> {
      await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId))
    },
    async createAuthToken(userId, tokenHash, type, expiresAt): Promise<void> {
      await db.insert(authTokens).values({ userId, tokenHash, type, expiresAt })
    },
    async findActiveAuthToken(tokenHash, type): Promise<AuthToken | undefined> {
      const rows = await db
        .select()
        .from(authTokens)
        .where(
          and(
            eq(authTokens.tokenHash, tokenHash),
            eq(authTokens.type, type),
            isNull(authTokens.usedAt),
          ),
        )
        .limit(1)
      return rows[0]
    },
    async markAuthTokenUsed(id): Promise<void> {
      await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, id))
    },
    async createRefreshToken(userId, tokenHash, expiresAt): Promise<void> {
      await db.insert(refreshTokens).values({ userId, tokenHash, expiresAt })
    },
    async findRefreshTokenByHash(tokenHash): Promise<RefreshToken | undefined> {
      const rows = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1)
      return rows[0]
    },
    async revokeRefreshToken(id): Promise<void> {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, id))
    },
    async revokeAllRefreshTokens(userId): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    },
  }
}
