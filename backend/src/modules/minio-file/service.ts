import { AbstractFileProviderService, MedusaError } from '@medusajs/framework/utils';
import { Logger } from '@medusajs/framework/types';
import {
  ProviderUploadFileDTO,
  ProviderDeleteFileDTO,
  ProviderFileResultDTO,
  ProviderGetFileDTO,
  ProviderGetPresignedUploadUrlDTO
} from '@medusajs/framework/types';
import { Client } from 'minio';
import path from 'path';
import { ulid } from 'ulid';
import { Readable } from 'stream';
import sharp from 'sharp';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const MAX_DIMENSION = 1200; // px — resize nếu lớn hơn
const WEBP_QUALITY = 82;   // chất lượng WebP

type InjectedDependencies = {
  logger: Logger
}

interface MinioServiceConfig {
  endPoint: string
  accessKey: string
  secretKey: string
  bucket?: string
}

export interface MinioFileProviderOptions {
  endPoint: string
  accessKey: string
  secretKey: string
  bucket?: string
}

const DEFAULT_BUCKET = 'medusa-media'

/**
 * Service to handle file storage using MinIO.
 */
class MinioFileProviderService extends AbstractFileProviderService {
  static identifier = 'minio-file'
  protected readonly config_: MinioServiceConfig
  protected readonly logger_: Logger
  protected client: Client
  protected readonly bucket: string
  protected readonly useSSL: boolean

  constructor({ logger }: InjectedDependencies, options: MinioFileProviderOptions) {
    super()
    this.logger_ = logger
    
    // Parse endpoint to extract hostname and protocol
    let endPoint = options.endPoint
    let useSSL = true
    let port = 443
    
    // Strip protocol if present (MinIO client v8+ requires hostname only)
    if (endPoint.startsWith('https://')) {
      endPoint = endPoint.replace('https://', '')
      useSSL = true
      port = 443
    } else if (endPoint.startsWith('http://')) {
      endPoint = endPoint.replace('http://', '')
      useSSL = false
      port = 80
    }
    
    // Remove trailing slash if present
    endPoint = endPoint.replace(/\/$/, '')
    
    // Extract port from endpoint if specified (e.g., "minio.example.com:9000")
    const portMatch = endPoint.match(/:(\d+)$/)
    if (portMatch) {
      port = parseInt(portMatch[1], 10)
      endPoint = endPoint.replace(/:(\d+)$/, '')
    }
    
    this.config_ = {
      endPoint: endPoint,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
      bucket: options.bucket
    }

    // Use provided bucket or default
    this.bucket = this.config_.bucket || DEFAULT_BUCKET
    this.useSSL = useSSL
    this.logger_.info(`MinIO service initialized with bucket: ${this.bucket}, endpoint: ${endPoint}, port: ${port}, SSL: ${useSSL}`)

    // Initialize Minio client with parsed settings
    this.client = new Client({
      endPoint: endPoint,
      port: port,
      useSSL: useSSL,
      accessKey: this.config_.accessKey,
      secretKey: this.config_.secretKey,
      pathStyle: true,
      region: 'us-east-1',
      partSize: 100 * 1024 * 1024, // 100MB — force single-part upload
    })

    // Initialize bucket and policy
    this.initializeBucket().catch(error => {
      this.logger_.error(`Failed to initialize MinIO bucket: ${error.message}`)
    })
  }

  static validateOptions(options: Record<string, any>) {
    const requiredFields = [
      'endPoint',
      'accessKey',
      'secretKey'
    ]

    requiredFields.forEach((field) => {
      if (!options[field]) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `${field} is required in the provider's options`
        )
      }
    })
  }

  private async initializeBucket(): Promise<void> {
    try {
      // Check if bucket exists
      const bucketExists = await this.client.bucketExists(this.bucket)
      
      if (!bucketExists) {
        // Create the bucket
        await this.client.makeBucket(this.bucket)
        this.logger_.info(`Created bucket: ${this.bucket}`)

        // Set bucket policy to allow public read access
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PublicRead',
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.bucket}/*`]
            }
          ]
        }

        await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy))
        this.logger_.info(`Set public read policy for bucket: ${this.bucket}`)
      } else {
        this.logger_.info(`Using existing bucket: ${this.bucket}`)
        
        // Verify/update policy on existing bucket
        try {
          const policy = {
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'PublicRead',
                Effect: 'Allow',
                Principal: '*',
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${this.bucket}/*`]
              }
            ]
          }
          await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy))
          this.logger_.info(`Updated public read policy for existing bucket: ${this.bucket}`)
        } catch (policyError) {
          this.logger_.warn(`Failed to update policy for existing bucket: ${policyError.message}`)
        }
      }
    } catch (error) {
      this.logger_.error(`Error initializing bucket: ${error.message}`)
      throw error
    }
  }

  private async compressImage(content: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
    // GIF không xử lý — giữ nguyên
    if (mimeType === 'image/gif') {
      return { buffer: content, mimeType, ext: '.gif' }
    }

    const compressed = await sharp(content)
      .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer()

    // Chỉ dùng WebP nếu nhỏ hơn ảnh gốc
    if (compressed.length < content.length) {
      return { buffer: compressed, mimeType: 'image/webp', ext: '.webp' }
    }
    return { buffer: content, mimeType, ext: path.extname('file.' + mimeType.split('/')[1]) || '.jpg' }
  }

  async upload(
    file: ProviderUploadFileDTO
  ): Promise<ProviderFileResultDTO> {
    if (!file) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file provided'
      )
    }

    if (!file.filename) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No filename provided'
      )
    }

    try {
      const parsedFilename = path.parse(file.filename)
      const safeName = parsedFilename.name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "")

      // Đọc content thành Buffer
      let content: Buffer
      if (Buffer.isBuffer(file.content)) {
        content = file.content
      } else if (typeof file.content === 'string') {
        if (file.content.match(/^[A-Za-z0-9+/]+=*$/)) {
          content = Buffer.from(file.content, 'base64')
        } else {
          content = Buffer.from(file.content, 'binary')
        }
      } else {
        content = Buffer.from(file.content as any)
      }

      // Compress ảnh nếu là image
      let finalContent = content
      let finalMimeType = file.mimeType
      let finalExt = parsedFilename.ext

      if (IMAGE_MIME_TYPES.has(file.mimeType)) {
        try {
          const result = await this.compressImage(content, file.mimeType)
          finalContent = result.buffer
          finalMimeType = result.mimeType
          finalExt = result.ext
          const ratio = Math.round((1 - result.buffer.length / content.length) * 100)
          this.logger_.info(`Compressed image: ${content.length}b → ${result.buffer.length}b (${ratio}% smaller)`)
        } catch (compressError) {
          this.logger_.warn(`Image compression failed, using original: ${compressError.message}`)
        }
      }

      const fileKey = `${safeName}-${ulid()}${finalExt}`

      await this.client.putObject(
        this.bucket,
        fileKey,
        finalContent,
        finalContent.length,
        {
          'Content-Type': finalMimeType,
          'x-amz-meta-original-filename': file.filename,
          'x-amz-acl': 'public-read'
        }
      )

      const protocol = this.useSSL ? 'https' : 'http'
      const url = `${protocol}://${this.config_.endPoint}/${this.bucket}/${fileKey}`

      this.logger_.info(`Successfully uploaded file ${fileKey} to MinIO bucket ${this.bucket}`)

      return {
        url,
        key: fileKey
      }
    } catch (error) {
      this.logger_.error(`Failed to upload file: ${error.message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to upload file: ${error.message}`
      )
    }
  }

  async delete(
    fileData: ProviderDeleteFileDTO | ProviderDeleteFileDTO[]
  ): Promise<void> {
    const files = Array.isArray(fileData) ? fileData : [fileData];

    for (const file of files) {
      if (!file?.fileKey) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          'No file key provided'
        );
      }

      try {
        await this.client.removeObject(this.bucket, file.fileKey);
        this.logger_.info(`Successfully deleted file ${file.fileKey} from MinIO bucket ${this.bucket}`);
      } catch (error) {
        this.logger_.warn(`Failed to delete file ${file.fileKey}: ${error.message}`);
      }
    }
  }

  async getPresignedDownloadUrl(
    fileData: ProviderGetFileDTO
  ): Promise<string> {
    if (!fileData?.fileKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file key provided'
      )
    }

    try {
      const url = await this.client.presignedGetObject(
        this.bucket,
        fileData.fileKey,
        24 * 60 * 60 // URL expires in 24 hours
      )
      this.logger_.info(`Generated presigned URL for file ${fileData.fileKey}`)
      return url
    } catch (error) {
      this.logger_.error(`Failed to generate presigned URL: ${error.message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to generate presigned URL: ${error.message}`
      )
    }
  }

  async getPresignedUploadUrl(
    fileData: ProviderGetPresignedUploadUrlDTO
  ): Promise<ProviderFileResultDTO> {
    if (!fileData?.filename) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No filename provided'
      )
    }

    try {
      const parsedFilename = path.parse(fileData.filename)
      const safeName = parsedFilename.name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "")
      const fileKey = `${safeName}-${ulid()}${parsedFilename.ext}`

      // Generate presigned PUT URL that expires in 15 minutes
      const url = await this.client.presignedPutObject(
        this.bucket,
        fileKey,
        15 * 60 // URL expires in 15 minutes
      )

      return {
        url,
        key: fileKey
      }
    } catch (error) {
      this.logger_.error(`Failed to generate presigned upload URL: ${error.message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to generate presigned upload URL: ${error.message}`
      )
    }
  }

  async getAsBuffer(fileData: ProviderGetFileDTO): Promise<Buffer> {
    if (!fileData?.fileKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file key provided'
      )
    }

    try {
      const stream = await this.client.getObject(this.bucket, fileData.fileKey)
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []

        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', reject)
      })

      this.logger_.info(`Retrieved buffer for file ${fileData.fileKey}`)
      return buffer
    } catch (error) {
      this.logger_.error(`Failed to get buffer: ${error.message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to get buffer: ${error.message}`
      )
    }
  }

  async getDownloadStream(fileData: ProviderGetFileDTO): Promise<Readable> {
    if (!fileData?.fileKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'No file key provided'
      )
    }

    try {
      // Get the MinIO stream directly
      const minioStream = await this.client.getObject(this.bucket, fileData.fileKey)

      this.logger_.info(`Retrieved download stream for file ${fileData.fileKey}`)
      return minioStream
    } catch (error) {
      this.logger_.error(`Failed to get download stream: ${error.message}`)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to get download stream: ${error.message}`
      )
    }
  }
}

export default MinioFileProviderService
