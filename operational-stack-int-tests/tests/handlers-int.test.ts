import { getHandlerUrls } from '../src/stack-outputs';

const stackName = process.env.STACK_NAME || 'OperationalHooksStack';

describe('Operational Hooks handlers (deployed)', () => {
  let transactionWebhookUrl: string;
  let itemCreatedUrl: string;

  beforeAll(async () => {
    ({ transactionWebhookUrl, itemCreatedUrl } = await getHandlerUrls(stackName));
  });

  const usedSetItemPayload = {
    id: 109679,
    metadata: {},
    cost: 2.16,
    price: 7,
    description: '60240 Kayak Adventure',
    allowFractionalQty: false,
    publicId: '60240-all',
    defaultLookupId: 109679,
    longDescription: '60240 Kayak Adventure',
    custom: {
      upc: '',
      tags: '',
      theme: '',
      series: '',
      retired: '',
      category: 'Town',
      department: 'Used Sets',
      launchDate: '',
      bamCategory: 'Allowance Set',
      bricklinkId: '60240-1',
      taxCategory: 'Yes',
      subDepartment: 'Used Set',
      retirementDate: '',
      launch_date: '',
      bam_category: 'Allowance Set',
      bricklink_id: '60240-1',
      tax_category: 'Yes',
      sub_department: 'Used Set',
      retirement_date: '',
    },
    active: true,
    createdAt: '2026-01-17T02:23:29+00:00',
    updatedAt: '2026-01-17T02:23:29+00:00',
    financialClassId: null,
    importBatchId: null,
    primaryVendorId: 100004,
    primaryBarcode: 'SR109679',
    gridId: null,
    originalPrice: null,
    sortKey: 6367094,
    metadataPrivate: null,
    importSetId: null,
    createdByUserId: 100009,
    promptForPrice: false,
    promptForDescription: false,
    useDynamicMargin: false,
    dynamicMargin: null,
    updatedByUserId: 100009,
    weight: null,
    width: null,
    height: null,
    depth: null,
    trackInventory: true,
    addOnForItemsMatchingFilter: false,
    addOnItemFilter: null,
    uuid: 'ec0fcca3-ffd6-471b-8d38-aad0939cd045',
    primaryImageId: null,
    defaultPriceListId: 1,
    type: 'regular',
    availableOnline: false,
    hasImages: null,
    weightUnit: null,
    widthUnit: null,
    heightUnit: null,
    depthUnit: null,
    productType: 'simple',
  };

  test.skip('transaction handler accepts a webhook payload', async () => {
    const response = await fetch(transactionWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.ok).toBe(true);
  });

  test.skip('item created handler accepts a webhook payload', async () => {
    const response = await fetch(itemCreatedUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.ok).toBe(true);
  });

  test('item created handler accepts used set payload', async () => {
    const response = await fetch(itemCreatedUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(usedSetItemPayload),
    });

    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body).toEqual({ status: 'ok' });
  });

  const retiredNewInBoxPayload = {
    id: 109676,
    metadata: {},
    cost: 4.75,
    price: 20,
    description: '40777 Celebration Series: 4. Gingerbread Train Ornament',
    allowFractionalQty: false,
    publicId: '40777-2',
    defaultLookupId: 109676,
    longDescription: '40777 Celebration Series: 4. Gingerbread Train Ornament',
    custom: {
      upc: '',
      tags: '',
      theme: '',
      series: '',
      retired: '',
      category: 'Creator',
      department: 'New Sets',
      launchDate: '',
      bamCategory: 'Boxed Set',
      bricklinkId: '40777-1',
      taxCategory: 'Yes',
      subDepartment: 'Retired New In Box',
      retirementDate: '',
      launch_date: '',
      bam_category: 'Boxed Set',
      bricklink_id: '40777-1',
      tax_category: 'Yes',
      sub_department: 'Retired New In Box',
      retirement_date: '',
    },
    active: true,
    createdAt: '2026-01-14T15:56:15+00:00',
    updatedAt: '2026-01-14T15:56:15+00:00',
    financialClassId: null,
    importBatchId: null,
    primaryVendorId: 100004,
    primaryBarcode: 'SR109676',
    gridId: null,
    originalPrice: null,
    sortKey: 6367091,
    metadataPrivate: null,
    importSetId: null,
    createdByUserId: 100009,
    promptForPrice: false,
    promptForDescription: false,
    useDynamicMargin: false,
    dynamicMargin: null,
    updatedByUserId: 100009,
    weight: null,
    width: null,
    height: null,
    depth: null,
    trackInventory: true,
    addOnForItemsMatchingFilter: false,
    addOnItemFilter: null,
    uuid: '48a53761-5023-467d-86ff-28beddfea816',
    primaryImageId: null,
    defaultPriceListId: 1,
    type: 'regular',
    availableOnline: false,
    hasImages: null,
    weightUnit: null,
    widthUnit: null,
    heightUnit: null,
    depthUnit: null,
    productType: 'simple',
  };

  test('item created handler accepts retired new in box payload', async () => {
    const response = await fetch(itemCreatedUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(retiredNewInBoxPayload),
    });

    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body).toEqual({ status: 'ok' });
  });
});
