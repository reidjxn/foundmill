import { z } from "zod";

/** Service names are lowercase slugs. The allowlist (deploy-services.ts) decides which are deployable. */
export const serviceNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "service must be a lowercase slug");

export const commitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "commit_sha must be a full 40-char lowercase hex SHA");

export const deployIdSchema = z.string().min(1).max(128);

/** Strict: unknown keys (for example an agent-supplied allowlist) are rejected, not stripped. */
export const deployServiceInputSchema = z.strictObject({
  service: serviceNameSchema,
  commit_sha: commitShaSchema,
});
export type DeployServiceInput = z.infer<typeof deployServiceInputSchema>;

export const getDeployStatusInputSchema = z.strictObject({ deploy_id: deployIdSchema });
export type GetDeployStatusInput = z.infer<typeof getDeployStatusInputSchema>;

export const deployStateSchema = z.enum([
  "queued",
  "building",
  "deploying",
  "succeeded",
  "failed",
  "canceled",
]);
export type DeployState = z.infer<typeof deployStateSchema>;

export const deployStatusSchema = z.object({
  deploy_id: deployIdSchema,
  service: serviceNameSchema,
  commit_sha: commitShaSchema,
  state: deployStateSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type DeployStatus = z.infer<typeof deployStatusSchema>;

export const deployServiceOutputSchema = deployStatusSchema;
export type DeployServiceOutput = DeployStatus;

/** Error codes shared by the real and mock providers. */
export const deployErrorCodeSchema = z.enum([
  "service_not_allowlisted",
  "commit_not_main_head",
  "ci_not_succeeded",
  "deploy_not_found",
  "invalid_input",
  "provider_error",
]);
export type DeployErrorCode = z.infer<typeof deployErrorCodeSchema>;

/** Refusals are policy decisions (nothing was deployed); the rest are failures. */
export const DEPLOY_REFUSAL_CODES = [
  "service_not_allowlisted",
  "commit_not_main_head",
  "ci_not_succeeded",
] as const satisfies readonly DeployErrorCode[];
export type DeployRefusalCode = (typeof DEPLOY_REFUSAL_CODES)[number];
