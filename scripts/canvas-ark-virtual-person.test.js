const assert = require("node:assert/strict");
const { __test } = require("../server.js");

const {
  buildOpenApiRequest,
  normalizeAssetResult,
  createAsset,
  getAsset,
  sanitizeState,
  isWorkflowArkAutoCertificationAsset,
  isWorkflowArkPersonAutoCertificationAsset,
} = __test.arkVirtualPerson;

assert.equal(
  isWorkflowArkAutoCertificationAsset({ source: "shared-asset-library", assetStylePreset: "photoreal" }),
  false,
  "shared library assets must not enter the automatic Ark path",
);
assert.equal(
  isWorkflowArkAutoCertificationAsset({ source: "canvas-image", assetStylePreset: "photoreal" }),
  false,
  "standalone canvas images must not enter the automatic Ark path",
);
assert.equal(
  isWorkflowArkAutoCertificationAsset({ source: "project", assetStylePreset: "photoreal" }),
  true,
  "workflow photoreal assets may enter the automatic Ark path",
);
assert.equal(
  isWorkflowArkAutoCertificationAsset({ source: "project", assetStylePreset: "three_d" }),
  true,
  "workflow 3D aliases may enter the automatic Ark path",
);
assert.equal(
  isWorkflowArkAutoCertificationAsset({ source: "project", assetStylePreset: "modern_anime_cel" }),
  false,
  "ordinary workflow styles must not enter the automatic Ark path",
);
assert.equal(
  isWorkflowArkPersonAutoCertificationAsset({ source: "shared-asset-library", assetStylePreset: "cg_3d", type: "Character" }),
  false,
  "shared library character assets must remain manual-only on the canvas",
);
assert.equal(
  isWorkflowArkPersonAutoCertificationAsset({ source: "project", assetStylePreset: "cg_3d", type: "Character" }),
  true,
  "workflow 3D character assets may be auto-certified",
);
const request = buildOpenApiRequest(
  "CreateAsset",
  {
    GroupId: "group-aigc-1",
    URL: "https://assets.example.com/person.png",
    Name: "virtual-person-a",
  },
  {
    accessKeyId: "test-ak",
    secretAccessKey: "test-sk",
    region: "cn-beijing",
    service: "ark",
    endpoint: "https://ark.cn-beijing.volcengineapi.com",
    version: "2024-01-01",
    now: new Date("2026-07-17T08:09:10.000Z"),
  },
);

assert.equal(
  request.url,
  "https://ark.cn-beijing.volcengineapi.com/?Action=CreateAsset&Version=2024-01-01",
);
assert.deepEqual(JSON.parse(request.body), {
  GroupId: "group-aigc-1",
  URL: "https://assets.example.com/person.png",
  Name: "virtual-person-a",
});
assert.equal(request.headers["X-Date"], "20260717T080910Z");
assert.match(request.headers.Authorization, /^HMAC-SHA256 Credential=test-ak\/20260717\/cn-beijing\/ark\/request,/);
assert.match(request.headers.Authorization, /SignedHeaders=host;x-content-sha256;x-date,/);
assert.equal(request.headers["X-Content-Sha256"].length, 64);

assert.deepEqual(
  normalizeAssetResult({ Result: { Id: "asset-1", Status: "Active", GroupId: "group-aigc-1" } }),
  {
    assetId: "asset-1",
    assetUrl: "asset://asset-1",
    groupId: "group-aigc-1",
    status: "active",
    error: "",
  },
);
assert.equal(normalizeAssetResult({ Result: { Id: "asset-2", Status: "Processing" } }).status, "processing");
assert.equal(normalizeAssetResult({ Result: { Id: "asset-3", Status: "Failed", Error: { Message: "face missing" } } }).error, "face missing");
assert.equal(normalizeAssetResult({ Result: { Id: "asset-4", Status: "Failed", FailedReason: "not photoreal" } }).error, "not photoreal");

const sanitized = sanitizeState({
  projectId: "standalone",
  assets: [{
    id: "person-a",
    name: "Virtual Person A",
    url: "/public-assets/person-a.png",
    arkPersonAsset: {
      enabled: true,
      assetId: "asset-1",
      assetUrl: "asset://asset-1",
      groupId: "group-aigc-1",
      status: "active",
      boundAt: "2026-07-17T08:09:10.000Z",
    },
  }],
});
assert.equal(sanitized.assets[0].arkPersonAsset.assetUrl, "asset://asset-1");
assert.equal(sanitized.assets[0].arkPersonAsset.status, "active");

assert.throws(
  () => buildOpenApiRequest("CreateAsset", {}, { accessKeyId: "", secretAccessKey: "" }),
  /ARK_ASSETS_ACCESS_KEY_ID.*ARK_ASSETS_SECRET_ACCESS_KEY/,
);

(async () => {
  let submitted = null;
  const result = await createAsset(
    {
      asset: {
        id: "person-a",
        name: "Virtual Person A.png",
        url: "/public-assets/person-a.png",
        source: "canvas-image",
        generationMode: "ai-generated",
        aiGenerated: true,
        verificationType: "ai-generated",
        assetStylePreset: "photoreal",
      },
    },
    {
      config: {
        accessKeyId: "test-ak",
        secretAccessKey: "test-sk",
        groupId: "group-aigc-1",
        region: "cn-beijing",
        endpoint: "https://ark.cn-beijing.volcengineapi.com",
      },
      publicize: async () => ({ url: "https://assets.example.com/person-a.png" }),
      fetchImpl: async (url, options) => {
        submitted = { url, body: JSON.parse(options.body) };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ Result: { Id: "asset-created-1", Status: "Processing" } }),
        };
      },
    },
  );
  assert.deepEqual(submitted.body, {
    GroupId: "group-aigc-1",
    URL: "https://assets.example.com/person-a.png",
    AssetType: "Image",
    Name: "Virtual_Person_A",
    ProjectName: "default",
  });
  assert.equal(result.assetUrl, "asset://asset-created-1");
  assert.equal(result.status, "processing");

  let polled = null;
  const refreshed = await getAsset("asset-created-1", {
    config: {
      accessKeyId: "test-ak",
      secretAccessKey: "test-sk",
      region: "cn-beijing",
      endpoint: "https://ark.cn-beijing.volcengineapi.com",
    },
    fetchImpl: async (url, options) => {
      polled = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ Result: { Id: "asset-created-1", Status: "Active" } }),
      };
    },
  });
  assert.deepEqual(polled.body, { Id: "asset-created-1", ProjectName: "default" });
  assert.equal(refreshed.assetUrl, "asset://asset-created-1");
  assert.equal(refreshed.status, "active");
  console.log("canvas Ark virtual-person tests passed.");
})();
