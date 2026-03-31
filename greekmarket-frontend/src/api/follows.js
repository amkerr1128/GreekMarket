import API from "./axios";

const PATHS = {
  user: {
    follow: (id) => [`/users/${id}/follow`],
    followers: (id) => [
      `/users/${id}/followers`,
      `/users/${id}/followed-by`,
      `/followers/users/${id}`,
    ],
    following: (id) => [
      `/users/${id}/following`,
      `/users/${id}/follows`,
      `/following/users/${id}`,
    ],
  },
  school: {
    follow: (id) => [`/schools/${id}/follow`],
    followers: (id) => [
      `/schools/${id}/followers`,
      `/schools/${id}/followed-by`,
    ],
    following: (id) => [
      `/schools/${id}/following`,
      `/schools/${id}/follows`,
    ],
  },
  chapter: {
    follow: (id) => [`/chapters/${id}/follow`],
    followers: (id) => [
      `/chapters/${id}/followers`,
      `/chapters/${id}/followed-by`,
    ],
    following: (id) => [
      `/chapters/${id}/following`,
      `/chapters/${id}/follows`,
    ],
  },
};

function isMissingEndpoint(error) {
  const status = error?.response?.status;
  return status === 404 || status === 405;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.followers)) return value.followers;
  if (Array.isArray(value?.following)) return value.following;
  if (Array.isArray(value?.members)) return value.members;
  if (Array.isArray(value?.users)) return value.users;
  if (Array.isArray(value?.accounts)) return value.accounts;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function normalizeCount(candidate) {
  if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === "string" && candidate.trim() !== "" && !Number.isNaN(Number(candidate))) {
    return Number(candidate);
  }
  return null;
}

function getKeys(kind) {
  return PATHS[kind] || PATHS.user;
}

async function requestList(paths) {
  let lastError = null;
  for (const path of paths) {
    try {
      const { data } = await API.get(path);
      return { data, path };
    } catch (error) {
      lastError = error;
      if (!isMissingEndpoint(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function requestFollow(paths, method) {
  let lastError = null;
  for (const path of paths) {
    try {
      if (method === "delete") {
        return await API.delete(path);
      }
      return await API.post(path);
    } catch (error) {
      lastError = error;
      if (!isMissingEndpoint(error)) {
        throw error;
      }
    }
  }
  throw lastError;
}

export async function loadFollowNetwork(kind, id) {
  const keys = getKeys(kind);
  const next = {
    followers: [],
    following: [],
    counts: {
      followers: null,
      following: null,
    },
    available: {
      followers: false,
      following: false,
    },
  };

  try {
    const followersResult = await requestList(keys.followers(id));
    next.followers = asArray(followersResult.data);
    next.available.followers = true;
    next.counts.followers =
      normalizeCount(followersResult.data?.count) ??
      normalizeCount(followersResult.data?.total) ??
      normalizeCount(followersResult.data?.followers_count) ??
      next.followers.length;
  } catch {
    // Keep graceful fallback if the backend has not exposed the list endpoint yet.
  }

  try {
    const followingResult = await requestList(keys.following(id));
    next.following = asArray(followingResult.data);
    next.available.following = true;
    next.counts.following =
      normalizeCount(followingResult.data?.count) ??
      normalizeCount(followingResult.data?.total) ??
      normalizeCount(followingResult.data?.following_count) ??
      next.following.length;
  } catch {
    // Keep graceful fallback if the backend has not exposed the list endpoint yet.
  }

  return next;
}

export async function toggleFollow(kind, id, shouldFollow) {
  const keys = getKeys(kind);
  return shouldFollow ? requestFollow(keys.follow(id), "post") : requestFollow(keys.follow(id), "delete");
}

export function normalizeFollowCount(source, keys = []) {
  for (const key of keys) {
    const value = normalizeCount(source?.[key]);
    if (value !== null) return value;
  }
  return 0;
}

