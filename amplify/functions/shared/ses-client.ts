import { SESClient } from '@aws-sdk/client-ses';
import { AWS_DEPLOYMENT_REGION } from '../../deployment-region';

/** SES must use the same region where sender/recipient identities are verified. */
export function createSesClient(): SESClient {
  return new SESClient({
    region: process.env.AWS_REGION ?? AWS_DEPLOYMENT_REGION,
  });
}
