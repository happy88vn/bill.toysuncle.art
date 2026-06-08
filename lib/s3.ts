import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client, getBucketConfig } from "./aws-config";

const s3Client = createS3Client();
const { bucketName, folderPrefix } = getBucketConfig();

export async function generatePresignedUploadUrl(fileName: string, contentType: string, isPublic = false): Promise<{ uploadUrl: string; cloud_storage_path: string }> {
  const cloud_storage_path = isPublic ? `${folderPrefix}public/uploads/${Date.now()}-${fileName}` : `${folderPrefix}uploads/${Date.now()}-${fileName}`;
  const command = new PutObjectCommand({ Bucket: bucketName, Key: cloud_storage_path, ContentType: contentType, ContentDisposition: isPublic ? "attachment" : undefined });
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return { uploadUrl, cloud_storage_path };
}

export async function initiateMultipartUpload(fileName: string, isPublic = false): Promise<{ uploadId: string; cloud_storage_path: string }> {
  const cloud_storage_path = isPublic ? `${folderPrefix}public/uploads/${Date.now()}-${fileName}` : `${folderPrefix}uploads/${Date.now()}-${fileName}`;
  const command = new CreateMultipartUploadCommand({ Bucket: bucketName, Key: cloud_storage_path, ContentDisposition: isPublic ? "attachment" : undefined });
  const response = await s3Client.send(command);
  return { uploadId: response.UploadId ?? "", cloud_storage_path };
}

export async function getPresignedUrlForPart(cloud_storage_path: string, uploadId: string, partNumber: number): Promise<string> {
  const command = new UploadPartCommand({ Bucket: bucketName, Key: cloud_storage_path, UploadId: uploadId, PartNumber: partNumber });
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

export async function completeMultipartUpload(cloud_storage_path: string, uploadId: string, parts: { ETag: string; PartNumber: number }[]): Promise<void> {
  const command = new CompleteMultipartUploadCommand({ Bucket: bucketName, Key: cloud_storage_path, UploadId: uploadId, MultipartUpload: { Parts: parts } });
  await s3Client.send(command);
}

export async function getFileUrl(cloud_storage_path: string, isPublic: boolean): Promise<string> {
  if (isPublic) {
    // R2 (or any S3-compatible store) exposes public objects via a configured
    // public base URL (R2 public bucket / custom domain). Fall back to the
    // legacy AWS virtual-hosted URL when no base URL is set.
    const publicBase = process.env.S3_PUBLIC_BASE_URL;
    if (publicBase) {
      return `${publicBase.replace(/\/$/, "")}/${cloud_storage_path}`;
    }
    const region = process.env.AWS_REGION ?? "us-east-1";
    return `https://${bucketName}.s3.${region}.amazonaws.com/${cloud_storage_path}`;
  }
  const command = new GetObjectCommand({ Bucket: bucketName, Key: cloud_storage_path, ResponseContentDisposition: "attachment" });
  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

export async function deleteFile(cloud_storage_path: string): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: bucketName, Key: cloud_storage_path });
  await s3Client.send(command);
}
