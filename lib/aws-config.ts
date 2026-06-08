import { S3Client } from "@aws-sdk/client-s3";

export function getBucketConfig() {
  return {
    bucketName: process.env.AWS_BUCKET_NAME ?? "",
    folderPrefix: process.env.AWS_FOLDER_PREFIX ?? ""
  };
}

/**
 * S3-compatible client.
 *
 * - On Abacus (legacy) it ran with empty config and picked up the hosted
 *   instance credentials via AWS_PROFILE.
 * - Off Abacus (Vercel + Cloudflare R2) we pass an explicit endpoint +
 *   access keys. R2 is S3-compatible, so only the connection details change.
 *
 * Env it reads (set these on Vercel):
 *   S3_ENDPOINT          e.g. https://<accountid>.r2.cloudflarestorage.com
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   AWS_REGION           "auto" for R2 (default)
 */
export function createS3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  // Explicit-credential mode (R2 / any S3-compatible store).
  if (endpoint && accessKeyId && secretAccessKey) {
    return new S3Client({
      region: process.env.AWS_REGION ?? "auto",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey }
    });
  }

  // Fallback: ambient credentials (AWS profile / instance role) — legacy Abacus.
  return new S3Client({});
}
