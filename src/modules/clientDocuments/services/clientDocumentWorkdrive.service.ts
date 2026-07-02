import axios, { AxiosInstance } from "axios";

type WorkdriveUploadResult = {
  fileId: string;
  permalink: string | null;
  folderId: string;
};

let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;

const createAccountsClient = (): AxiosInstance => {
  const accountsBase = process.env.ZOHO_ACCOUNTS_BASE?.trim();
  if (!accountsBase) throw new Error("ZOHO_ACCOUNTS_BASE is missing");
  return axios.create({ baseURL: accountsBase });
};

const WORKDRIVE_JSON_HEADERS = {
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
};

const createWorkdriveClient = (accessToken: string): AxiosInstance => {
  const workdriveBase = process.env.ZOHO_WORKDRIVE_BASE?.trim();
  if (!workdriveBase) throw new Error("ZOHO_WORKDRIVE_BASE is missing");

  return axios.create({
    baseURL: workdriveBase,
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      ...WORKDRIVE_JSON_HEADERS,
    },
  });
};

const getZohoAccessToken = async (): Promise<string> => {
  const now = Date.now();
  if (cachedAccessToken && now < cachedAccessTokenExpiresAt - 30_000) {
    return cachedAccessToken;
  }

  const clientId = process.env.ZOHO_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing Zoho OAuth env vars (ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN)");
  }

  const payload = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await createAccountsClient().post("/oauth/v2/token", payload, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const token = String(response.data?.access_token || "");
  if (!token) {
    throw new Error("Unable to fetch Zoho access token");
  }

  const expiresInSeconds = Number(response.data?.expires_in ?? 3600);
  cachedAccessToken = token;
  cachedAccessTokenExpiresAt = now + expiresInSeconds * 1000;
  return token;
};

const isWorkdriveFolder = (entry: any): boolean => {
  const attrs = entry?.attributes ?? {};
  return attrs.is_folder === true || attrs.type === "folder" || attrs.resource_type === 1001;
};

const findChildFolderByName = async (
  client: AxiosInstance,
  parentFolderId: string,
  folderName: string
): Promise<string | null> => {
  const targetName = folderName.trim().toLowerCase();
  if (!targetName) return null;

  let pageNext = "0";

  while (true) {
    const response = await client.get(`/files/${parentFolderId}/files`, {
      params: {
        "page[limit]": 200,
        "page[next]": pageNext,
      },
    });

    const data = Array.isArray(response.data?.data) ? response.data.data : [];
    const existing = data.find((entry: any) => {
      const attrs = entry?.attributes ?? {};
      const entryName = String(attrs.name || "").trim().toLowerCase();
      return entryName === targetName && isWorkdriveFolder(entry);
    });

    if (existing?.id) return String(existing.id);

    const nextLink = response.data?.links?.next;
    if (!nextLink) break;

    try {
      const nextUrl = new URL(String(nextLink));
      const nextToken = nextUrl.searchParams.get("page[next]");
      if (!nextToken) break;
      pageNext = nextToken;
    } catch {
      break;
    }
  }

  return null;
};

const createFolder = async (
  client: AxiosInstance,
  parentFolderId: string,
  folderName: string
): Promise<string> => {
  const existingId = await findChildFolderByName(client, parentFolderId, folderName);
  if (existingId) return existingId;

  try {
    const response = await client.post(
      "/files",
      {
        data: {
          type: "files",
          attributes: {
            name: folderName,
            parent_id: parentFolderId,
          },
        },
      },
      {
        headers: {
          checkduplicatename: "true",
        },
      }
    );

    const folderId = response.data?.data?.id;
    if (!folderId) throw new Error("Folder create response missing id");
    return String(folderId);
  } catch (error: any) {
    const duplicateId = await findChildFolderByName(client, parentFolderId, folderName);
    if (duplicateId) return duplicateId;

    const apiMessage =
      error?.response?.data?.errors?.[0]?.title ||
      error?.response?.data?.message ||
      error?.message ||
      "unknown error";
    throw new Error(
      `Failed to create/find folder "${folderName}" in Zoho WorkDrive: ${apiMessage}`
    );
  }
};

export const ensureWorkdriveFolderHierarchy = async (
  pathSegments: string[]
): Promise<{ folderId: string; folderPath: string }> => {
  const rootFolderId = process.env.ZOHO_WD_ROOT_FOLDER_ID?.trim();
  if (!rootFolderId) throw new Error("ZOHO_WD_ROOT_FOLDER_ID is missing");

  const accessToken = await getZohoAccessToken();
  const client = createWorkdriveClient(accessToken);

  let parentId = rootFolderId;
  for (const segment of pathSegments) {
    parentId = await createFolder(client, parentId, segment);
  }

  return {
    folderId: parentId,
    folderPath: pathSegments.join("/"),
  };
};

const parseUploadedFileId = (entry: any): string | null => {
  if (entry?.id) return String(entry.id);

  const fileInfoRaw = entry?.attributes?.["File INFO"] ?? entry?.attributes?.file_info;
  if (typeof fileInfoRaw === "string") {
    try {
      const parsed = JSON.parse(fileInfoRaw) as { RESOURCE_ID?: string };
      if (parsed.RESOURCE_ID) return String(parsed.RESOURCE_ID);
    } catch {
      // ignore malformed File INFO payload
    }
  }

  const permalink = entry?.attributes?.Permalink ?? entry?.attributes?.permalink;
  if (typeof permalink === "string" && permalink.trim()) {
    const parts = permalink.split("/").filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return null;
};

export const uploadFileToWorkdrive = async (input: {
  folderId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<WorkdriveUploadResult> => {
  const accessToken = await getZohoAccessToken();
  const workdriveBase = process.env.ZOHO_WORKDRIVE_BASE?.trim();
  if (!workdriveBase) throw new Error("ZOHO_WORKDRIVE_BASE is missing");

  const workdriveUploadUrl =
    process.env.ZOHO_WORKDRIVE_UPLOAD_URL?.trim() || `${workdriveBase}/upload`;

  const form = new FormData();
  form.set(
    "content",
    new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }),
    input.fileName
  );

  const uploadParams = new URLSearchParams({
    filename: input.fileName,
    parent_id: input.folderId,
    "override-name-exist": "true",
  });

  const response = await axios.post(`${workdriveUploadUrl}?${uploadParams.toString()}`, form, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const entry = Array.isArray(response.data?.data)
    ? response.data.data[0]
    : response.data?.data;
  const fileId = parseUploadedFileId(entry);
  if (!fileId) {
    throw new Error("Zoho upload failed: missing file id in response");
  }

  const permalink =
    entry?.attributes?.Permalink ?? entry?.attributes?.permalink ?? null;

  return {
    fileId,
    permalink: permalink ? String(permalink) : null,
    folderId: input.folderId,
  };
};
