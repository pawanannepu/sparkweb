import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type { apiKeys } from "./api-keys";
import type { accounts, sessions, users, verificationTokens } from "./auth";
import type { deployments } from "./deployments";
import type { projects } from "./projects";
import type { promptMessages, promptThreads } from "./prompt-threads";
import type { snapshots } from "./snapshots";

export * from "./api-keys";
export * from "./auth";
export * from "./deployments";
export * from "./projects";
export * from "./prompt-threads";
export * from "./snapshots";

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type Account = InferSelectModel<typeof accounts>;
export type NewAccount = InferInsertModel<typeof accounts>;

export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

export type VerificationToken = InferSelectModel<typeof verificationTokens>;
export type NewVerificationToken = InferInsertModel<typeof verificationTokens>;

export type ApiKey = InferSelectModel<typeof apiKeys>;
export type NewApiKey = InferInsertModel<typeof apiKeys>;

export type Project = InferSelectModel<typeof projects>;
export type NewProject = InferInsertModel<typeof projects>;

export type PromptThread = InferSelectModel<typeof promptThreads>;
export type NewPromptThread = InferInsertModel<typeof promptThreads>;

export type PromptMessage = InferSelectModel<typeof promptMessages>;
export type NewPromptMessage = InferInsertModel<typeof promptMessages>;

export type Snapshot = InferSelectModel<typeof snapshots>;
export type NewSnapshot = InferInsertModel<typeof snapshots>;

export type Deployment = InferSelectModel<typeof deployments>;
export type NewDeployment = InferInsertModel<typeof deployments>;
