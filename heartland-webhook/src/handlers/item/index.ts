import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { HeartlandItemCreatedPayload } from '../../model';
import {
  DefaultBrickLinkClient,
  DefaultHeartlandApiClient,
} from '../../clients';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/**
 * Lambda handler for item_created webhook events.
 */
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  console.log(
    'Received Heartland item_created webhook event (envelope):',
    JSON.stringify(
      {
        headers: event.headers,
        requestContext: {
          http: event.requestContext?.http,
          timeEpoch: event.requestContext?.timeEpoch,
        },
      },
      null,
      2
    )
  );

  if (!event.body) {
    console.warn('Received item_created webhook with no body');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok' }),
    };
  }

  const parsed = parseItemCreatedBody(event.body);
  if (!parsed.ok) {
    console.error('Failed to parse item_created body:', parsed.error);
    console.error('Raw body:', event.body);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok' }),
    };
  }

  const payload = parsed.value;

  console.log(
    'Parsed Heartland item_created payload:',
    JSON.stringify(payload, null, 2)
  );

  const baseUrl = process.env.HEARTLAND_API_BASE_URL;
  const operationalSecretArn = process.env.OPERATIONAL_SECRET_ARN;

  if (!baseUrl || !operationalSecretArn) {
    console.warn(
      'Skipping item enrichment: missing HEARTLAND_API_BASE_URL or OPERATIONAL_SECRET_ARN'
    );
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok' }),
    };
  }

  if (typeof payload.id !== 'number') {
    console.warn('Skipping item enrichment: payload is missing numeric id');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok' }),
    };
  }

  const bricklinkId = payload.custom?.bricklinkId;
  if (!bricklinkId) {
    console.warn('Skipping item enrichment: missing bricklinkId');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok' }),
    };
  }

  try {
    const { heartlandToken, bricklinkCreds } =
      await getOperationalSecrets(operationalSecretArn);

    const heartlandClient = new DefaultHeartlandApiClient(
      baseUrl,
      heartlandToken
    );
    const bricklinkClient = new DefaultBrickLinkClient(
      bricklinkCreds.consumerKey,
      bricklinkCreds.consumerSecret,
      bricklinkCreds.tokenValue,
      bricklinkCreds.tokenSecret
    );

    const bricklinkItem = await bricklinkClient.getItem('SET', bricklinkId);
    const imageUrl =
      (bricklinkItem as { image_url?: string }).image_url ??
      bricklinkItem.item?.image_url;

    if (imageUrl) {
      await heartlandClient.updateInventoryItemImage(payload.id, imageUrl);
    } else {
      console.warn(
        'BrickLink item did not include image_url; skipping image update'
      );
    }

    const bamCategory = payload.custom?.bamCategory;
    const category = payload.custom?.category;
    const tags = ['add', bamCategory, category].filter(Boolean).join(', ');

    await heartlandClient.updateInventoryItem(payload.id, {
      custom: { tags },
    });
  } catch (err) {
    console.error('Error processing item_created enrichment:', err);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ok' }),
  };
};

const secretsClient = new SecretsManagerClient({});
let cachedHeartlandToken: string | null = null;
let cachedBricklinkCreds:
  | {
      consumerKey: string;
      consumerSecret: string;
      tokenValue: string;
      tokenSecret: string;
    }
  | null = null;

async function getOperationalSecrets(secretArn: string): Promise<{
  heartlandToken: string;
  bricklinkCreds: {
    consumerKey: string;
    consumerSecret: string;
    tokenValue: string;
    tokenSecret: string;
  };
}> {
  if (cachedHeartlandToken && cachedBricklinkCreds) {
    return {
      heartlandToken: cachedHeartlandToken,
      bricklinkCreds: cachedBricklinkCreds,
    };
  }

  const result = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!result.SecretString) {
    throw new Error('SecretString is empty in Secrets Manager response');
  }

  const parsed = JSON.parse(result.SecretString) as {
    heartland?: { token?: string };
    bricklink?: {
      consumerKey?: string;
      consumerSecret?: string;
      tokenValue?: string;
      tokenSecret?: string;
    };
  };

  const token = parsed.heartland?.token;
  if (!token) {
    throw new Error('Operational secret JSON does not contain heartland.token');
  }

  const consumerKey = parsed.bricklink?.consumerKey;
  const consumerSecret = parsed.bricklink?.consumerSecret;
  const tokenValue = parsed.bricklink?.tokenValue;
  const tokenSecret = parsed.bricklink?.tokenSecret;

  if (!consumerKey || !consumerSecret || !tokenValue || !tokenSecret) {
    throw new Error(
      'Operational secret JSON must include bricklink.consumerKey, bricklink.consumerSecret, bricklink.tokenValue, bricklink.tokenSecret'
    );
  }

  cachedHeartlandToken = token;
  cachedBricklinkCreds = {
    consumerKey,
    consumerSecret,
    tokenValue,
    tokenSecret,
  };

  return {
    heartlandToken: token,
    bricklinkCreds: cachedBricklinkCreds,
  };
}

type ParseResult =
  | { ok: true; value: HeartlandItemCreatedPayload }
  | { ok: false; error: string };

function parseItemCreatedBody(body: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(body) as unknown;
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${String(err)}` };
  }

  if (!isRecord(raw)) {
    return { ok: false, error: 'payload is not an object' };
  }

  const id = getNumber(raw, 'id');
  if (typeof id !== 'number') {
    return { ok: false, error: 'payload is missing a numeric id' };
  }

  const payload: HeartlandItemCreatedPayload = {
    id,
    metadata: getRecordOrNull(raw, 'metadata'),
    cost: getNumberOrNull(raw, 'cost'),
    price: getNumberOrNull(raw, 'price'),
    description: getString(raw, 'description'),
    allowFractionalQty: getBoolean(raw, 'allow_fractional_qty?'),
    publicId: getString(raw, 'public_id'),
    defaultLookupId: getNumberOrNull(raw, 'default_lookup_id'),
    longDescription: getString(raw, 'long_description'),
    custom: getCustomFields(raw.custom),
    active: getBoolean(raw, 'active?'),
    createdAt: getString(raw, 'created_at'),
    updatedAt: getString(raw, 'updated_at'),
    financialClassId: getNumberOrNull(raw, 'financial_class_id'),
    importBatchId: getNumberOrNull(raw, 'import_batch_id'),
    primaryVendorId: getNumberOrNull(raw, 'primary_vendor_id'),
    primaryBarcode: getStringOrNull(raw, 'primary_barcode'),
    gridId: getNumberOrNull(raw, 'grid_id'),
    originalPrice: getNumberOrNull(raw, 'original_price'),
    sortKey: getNumberOrNull(raw, 'sort_key'),
    metadataPrivate: getRecordOrNull(raw, 'metadata_private'),
    importSetId: getNumberOrNull(raw, 'import_set_id'),
    createdByUserId: getNumberOrNull(raw, 'created_by_user_id'),
    promptForPrice: getBoolean(raw, 'prompt_for_price?'),
    promptForDescription: getBoolean(raw, 'prompt_for_description?'),
    useDynamicMargin: getBoolean(raw, 'use_dynamic_margin?'),
    dynamicMargin: getNumberOrNull(raw, 'dynamic_margin'),
    updatedByUserId: getNumberOrNull(raw, 'updated_by_user_id'),
    weight: getNumberOrNull(raw, 'weight'),
    width: getNumberOrNull(raw, 'width'),
    height: getNumberOrNull(raw, 'height'),
    depth: getNumberOrNull(raw, 'depth'),
    trackInventory: getBoolean(raw, 'track_inventory?'),
    addOnForItemsMatchingFilter: getBoolean(
      raw,
      'add_on_for_items_matching_filter?'
    ),
    addOnItemFilter: getStringOrNull(raw, 'add_on_item_filter'),
    uuid: getString(raw, 'uuid'),
    primaryImageId: getNumberOrNull(raw, 'primary_image_id'),
    defaultPriceListId: getNumberOrNull(raw, 'default_price_list_id'),
    type: getString(raw, 'type'),
    availableOnline: getBoolean(raw, 'available_online?'),
    hasImages: getBooleanOrNull(raw, 'has_images?'),
    weightUnit: getStringOrNull(raw, 'weight_unit'),
    widthUnit: getStringOrNull(raw, 'width_unit'),
    heightUnit: getStringOrNull(raw, 'height_unit'),
    depthUnit: getStringOrNull(raw, 'depth_unit'),
    productType: getString(raw, 'product_type'),
  };

  return { ok: true, value: payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function getStringOrNull(
  source: Record<string, unknown>,
  key: string
): string | null | undefined {
  const value = source[key];
  if (value === null) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
}

function getNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' ? value : undefined;
}

function getNumberOrNull(
  source: Record<string, unknown>,
  key: string
): number | null | undefined {
  const value = source[key];
  if (value === null) {
    return null;
  }
  return typeof value === 'number' ? value : undefined;
}

function getBoolean(
  source: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
}

function getBooleanOrNull(
  source: Record<string, unknown>,
  key: string
): boolean | null | undefined {
  const value = source[key];
  if (value === null) {
    return null;
  }
  return typeof value === 'boolean' ? value : undefined;
}

function getRecordOrNull(
  source: Record<string, unknown>,
  key: string
): Record<string, unknown> | null | undefined {
  const value = source[key];
  if (value === null) {
    return null;
  }
  return isRecord(value) ? value : undefined;
}

function getCustomFields(
  value: unknown
): HeartlandItemCreatedPayload['custom'] {
  if (value === null || value === undefined) {
    return value as null | undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const mapped: HeartlandItemCreatedPayload['custom'] = {
    upc: getString(value, 'upc'),
    tags: getString(value, 'tags'),
    theme: getString(value, 'theme'),
    series: getString(value, 'series'),
    retired: getString(value, 'retired'),
    category: getString(value, 'category'),
    department: getString(value, 'department'),
    launchDate: getString(value, 'launch_date'),
    bamCategory: getString(value, 'bam_category'),
    bricklinkId: getString(value, 'bricklink_id'),
    taxCategory: getString(value, 'tax_category'),
    subDepartment: getString(value, 'sub_department'),
    retirementDate: getString(value, 'retirement_date'),
  };

  for (const [key, fieldValue] of Object.entries(value)) {
    if (!(key in mapped)) {
      mapped[key] = fieldValue;
    }
  }

  return mapped;
}
