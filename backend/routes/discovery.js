import express from "express";
import {
  getDiscoveryCache,
  updateDiscoveryCache,
  updateUserDiscoveryCache,
} from "../services/discoveryService.js";
import {
  lastfmRequest,
  getLastfmApiKey,
  clearApiCaches,
} from "../services/apiClients.js";
import { libraryManager } from "../services/libraryManager.js";
import { dbOps, userOps } from "../config/db-helpers.js";
import { imagePrefetchService } from "../services/imagePrefetchService.js";
import { defaultDiscoveryPreferences } from "../config/constants.js";
import { requireAdmin } from "../middleware/requirePermission.js";

const router = express.Router();

const pendingTagRequests = new Map();
const pendingTagSuggestRequest = { promise: null, expiry: 0 };

let discoveryPreferences = { ...defaultDiscoveryPreferences };

router.post("/refresh", (req, res) => {
  const userId = req.user?.id;
  let discoveryCache;

  if (userId) {
    discoveryCache = getDiscoveryCache(userId);
  } else {
    discoveryCache = getDiscoveryCache();
  }

  if (discoveryCache.isUpdating) {
    return res.status(409).json({
      message: "Discovery update already in progress",
      isUpdating: true,
    });
  }

  if (userId) {
    updateUserDiscoveryCache(userId);
  } else {
    updateDiscoveryCache();
  }

  res.json({
    message: "Discovery update started",
    isUpdating: true,
  });
});

router.post("/refresh-all", requireAdmin, (req, res) => {
  console.log(`[Discovery REFRESH-ALL] Admin triggered refresh for all caches`);

  updateDiscoveryCache();

  const allUsers = userOps.getAllUsers();
  for (const user of allUsers) {
    updateUserDiscoveryCache(user.id);
  }

  res.json({
    message: "Discovery refresh started for global cache and all users",
    globalRefreshStarted: true,
    userRefreshCount: allUsers.length,
  });
});

router.post("/clear", async (req, res) => {
  const { clearImages = true, scope = "user" } = req.body;
  const userId = req.user?.id;
  const isAdmin = req.user?.role === "admin";

  if (scope === "global" || scope === "all") {
    if (!isAdmin) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Admin access required for global or all scope",
      });
    }
  }

  const validScopes = ["global", "all", "user"];
  if (!validScopes.includes(scope)) {
    return res.status(400).json({
      error: "Invalid scope",
      message: `Scope must be one of: ${validScopes.join(", ")}`,
    });
  }

  console.log(`[Discovery CLEAR] Clearing cache with scope: ${scope}, user: ${userId || "anonymous"}`);

  if (scope === "all") {
    const allUsers = userOps.getAllUsers();
    for (const user of allUsers) {
      const userCache = getDiscoveryCache(user.id);
      Object.assign(userCache, {
        recommendations: [],
        globalTop: [],
        basedOn: [],
        topTags: [],
        topGenres: [],
        lastUpdated: null,
        isUpdating: false,
      });
      dbOps.clearUserDiscoveryCache(user.id);
      console.log(`[Discovery CLEAR] Cleared cache for user ${user.id}`);
    }

    const globalCache = getDiscoveryCache();
    Object.assign(globalCache, {
      recommendations: [],
      globalTop: [],
      basedOn: [],
      topTags: [],
      topGenres: [],
      lastUpdated: null,
      isUpdating: false,
    });
    dbOps.updateDiscoveryCache({
      recommendations: [],
      globalTop: [],
      basedOn: [],
      topTags: [],
      topGenres: [],
      lastUpdated: null,
    });
    console.log(`[Discovery CLEAR] Cleared global cache`);
  } else if (scope === "global") {
    const globalCache = getDiscoveryCache();
    Object.assign(globalCache, {
      recommendations: [],
      globalTop: [],
      basedOn: [],
      topTags: [],
      topGenres: [],
      lastUpdated: null,
      isUpdating: false,
    });
    dbOps.updateDiscoveryCache({
      recommendations: [],
      globalTop: [],
      basedOn: [],
      topTags: [],
      topGenres: [],
      lastUpdated: null,
    });
    console.log(`[Discovery CLEAR] Cleared global cache`);
  } else {
    if (userId) {
      const userCache = getDiscoveryCache(userId);
      Object.assign(userCache, {
        recommendations: [],
        globalTop: [],
        basedOn: [],
        topTags: [],
        topGenres: [],
        lastUpdated: null,
        isUpdating: false,
      });
      dbOps.clearUserDiscoveryCache(userId);
      console.log(`[Discovery CLEAR] Cleared user-specific cache for user ${userId}`);
    } else {
      const globalCache = getDiscoveryCache();
      Object.assign(globalCache, {
        recommendations: [],
        globalTop: [],
        basedOn: [],
        topTags: [],
        topGenres: [],
        lastUpdated: null,
        isUpdating: false,
      });
      console.log(`[Discovery CLEAR] Cleared global cache for anonymous user`);
    }
  }

  clearApiCaches();

  if (clearImages) {
    dbOps.clearImages();
  }

  pendingTagRequests.clear();
  pendingTagSuggestRequest.promise = null;
  pendingTagSuggestRequest.expiry = 0;

  res.json({
    message: clearImages
      ? "Discovery and image caches cleared"
      : "Discovery cache cleared",
  });
});

router.get("/", async (req, res) => {
  // Check if user is authenticated and has Last.fm settings
  const userId = req.user?.id;
  const hasLastfmKey = !!getLastfmApiKey();

  let discoveryCache;
  if (userId) {
    // Use user-specific cache if user is authenticated
    discoveryCache = getDiscoveryCache(userId);
  } else {
    // Use global cache for backward compatibility
    discoveryCache = getDiscoveryCache();
  }

  const settings = dbOps.getSettings();
  const globalLastfmUsername = settings.integrations?.lastfm?.username || null;
  
  // Fetch full user record to get user-specific Last.fm settings
  const fullUser = userId ? userOps.getUserById(userId) : null;
  const lastfmUsername = userId && fullUser ? fullUser.lastfmUsername : globalLastfmUsername;
  const hasLastfmUser = hasLastfmKey && lastfmUsername;
  const libraryArtists = await libraryManager.getAllArtists();
  const hasArtists = libraryArtists.length > 0;

  if (!hasLastfmKey && !hasArtists) {
    const dbData = dbOps.getDiscoveryCache();
    if (
      dbData.recommendations?.length > 0 ||
      dbData.globalTop?.length > 0 ||
      dbData.topGenres?.length > 0 ||
      dbData.basedOn?.length > 0
    ) {
      dbOps.updateDiscoveryCache({
        recommendations: [],
        globalTop: [],
        basedOn: [],
        topTags: [],
        topGenres: [],
        lastUpdated: null,
      });
    }

    Object.assign(discoveryCache, {
      recommendations: [],
      globalTop: [],
      basedOn: [],
      topTags: [],
      topGenres: [],
      lastUpdated: null,
      isUpdating: false,
    });

    res.set("Cache-Control", "public, max-age=300");
    return res.json({
      recommendations: [],
      globalTop: [],
      basedOn: [],
      topTags: [],
      topGenres: [],
      lastUpdated: null,
      isUpdating: false,
      configured: false,
    });
  }

  // Fetch database data - use user-specific cache if authenticated, otherwise global
  let dbData;
  if (userId) {
    dbData = dbOps.getUserDiscoveryCache(userId);
  } else {
    dbData = dbOps.getDiscoveryCache();
  }

  const hasData =
    dbData.recommendations?.length > 0 ||
    dbData.globalTop?.length > 0 ||
    dbData.topGenres?.length > 0 ||
    discoveryCache.recommendations?.length > 0 ||
    discoveryCache.globalTop?.length > 0 ||
    discoveryCache.topGenres?.length > 0;

  let isUpdating = discoveryCache.isUpdating || false;

  if (!hasData && !isUpdating) {
    // Update user-specific cache if user is authenticated, otherwise update global cache
    if (userId) {
      console.log(`[Discovery GET] No data found for user ${userId}, triggering lazy refresh`);
      updateUserDiscoveryCache(userId).catch((err) => {
        console.error(`[Discover] Lazy discovery refresh failed for user ${userId}:`, err.message);
      });
    } else {
      console.log(`[Discovery GET] No data found for anonymous user, triggering lazy refresh`);
      updateDiscoveryCache().catch((err) => {
        console.error("[Discover] Lazy discovery refresh failed:", err.message);
      });
    }
    isUpdating = true;
  }

  const dbHasData =
    dbData.recommendations?.length > 0 ||
    dbData.globalTop?.length > 0 ||
    dbData.topGenres?.length > 0;
  const cacheHasData =
    discoveryCache.recommendations?.length > 0 ||
    discoveryCache.globalTop?.length > 0 ||
    discoveryCache.topGenres?.length > 0;

  let recommendations, globalTop, basedOn, topTags, topGenres, lastUpdated;

  if (dbHasData) {
    recommendations = dbData.recommendations || [];
    globalTop = dbData.globalTop || [];
    basedOn = dbData.basedOn || [];
    topTags = dbData.topTags || [];
    topGenres = dbData.topGenres || [];
    lastUpdated = dbData.lastUpdated || null;
  } else if (cacheHasData) {
    recommendations = discoveryCache.recommendations || [];
    globalTop = discoveryCache.globalTop || [];
    basedOn = discoveryCache.basedOn || [];
    topTags = discoveryCache.topTags || [];
    topGenres = discoveryCache.topGenres || [];
    lastUpdated = discoveryCache.lastUpdated || null;
  } else {
    recommendations = [];
    globalTop = [];
    basedOn = [];
    topTags = [];
    topGenres = [];
    lastUpdated = null;
  }

  const existingArtistIds = new Set(libraryArtists.map((a) => a.mbid));

  recommendations = recommendations.filter(
    (artist) => !existingArtistIds.has(artist.id)
  );
  globalTop = globalTop.filter((artist) => !existingArtistIds.has(artist.id));

  if (
    recommendations.length > 0 ||
    globalTop.length > 0 ||
    topGenres.length > 0
  ) {
    Object.assign(discoveryCache, {
      recommendations,
      globalTop,
      basedOn,
      topTags,
      topGenres,
      lastUpdated,
      isUpdating: false,
    });
  }

  if (recommendations.length > 0 || globalTop.length > 0) {
    imagePrefetchService
      .prefetchDiscoveryImages({
        recommendations,
        globalTop,
      })
      .catch(() => {});
  }

  if (recommendations.length > 0 || globalTop.length > 0) {
    res.set("Cache-Control", "public, max-age=300");
  } else if (isUpdating) {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  } else {
    res.set("Cache-Control", "public, max-age=30");
  }

  res.json({
    recommendations,
    globalTop,
    basedOn,
    topTags,
    topGenres,
    lastUpdated,
    isUpdating,
    configured: true,
  });
});

router.get("/related", (req, res) => {
  const userId = req.user?.id;
  const discoveryCache = userId ? getDiscoveryCache(userId) : getDiscoveryCache();
  res.json({
    recommendations: discoveryCache.recommendations,
    basedOn: discoveryCache.basedOn,
    total: discoveryCache.recommendations.length,
  });
});

router.get("/similar", (req, res) => {
  const userId = req.user?.id;
  const discoveryCache = userId ? getDiscoveryCache(userId) : getDiscoveryCache();
  res.json({
    topTags: discoveryCache.topTags,
    topGenres: discoveryCache.topGenres,
    basedOn: discoveryCache.basedOn,
    message: "Served from cache",
  });
});

router.get("/tags", async (req, res) => {
  try {
    const { q = "", limit = 10 } = req.query;
    const limitInt = Math.min(parseInt(limit) || 10, 20);
    const prefix = String(q).trim().toLowerCase();
    let tagNames = [];
    if (getLastfmApiKey()) {
      let data;
      const now = Date.now();
      if (
        pendingTagSuggestRequest.promise &&
        pendingTagSuggestRequest.expiry > now
      ) {
        data = await pendingTagSuggestRequest.promise;
      } else {
        const fetchPromise = lastfmRequest("chart.getTopTags", { limit: 100 });
        pendingTagSuggestRequest.promise = fetchPromise;
        pendingTagSuggestRequest.expiry = now + 60000;
        data = await fetchPromise;
      }
      if (data?.tags?.tag) {
        const tags = Array.isArray(data.tags.tag)
          ? data.tags.tag
          : [data.tags.tag];
        tagNames = tags
          .map((t) => (t.name != null ? String(t.name).trim() : ""))
          .filter(Boolean);
      }
    }
    if (tagNames.length === 0) {
      const discoveryCache = getDiscoveryCache();
      const cached = [
        ...(discoveryCache.topTags || []),
        ...(discoveryCache.topGenres || []),
      ]
        .map((t) => (t != null ? String(t).trim() : ""))
        .filter(Boolean);
      tagNames = [...new Set(cached)];
    }
    const seen = new Set();
    const filtered = tagNames.filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      if (prefix && !key.startsWith(prefix)) return false;
      seen.add(key);
      return true;
    });
    res.json({ tags: filtered.slice(0, limitInt) });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch tag suggestions",
      message: error.message,
    });
  }
});

router.get("/by-tag", async (req, res) => {
  try {
    const { tag, limit = 24, offset = 0, includeLibrary, scope } = req.query;

    if (!tag) {
      return res.status(400).json({ error: "Tag parameter is required" });
    }

    const limitInt = Math.min(parseInt(limit) || 24, 50);
    const offsetInt = parseInt(offset) || 0;
    const page = Math.floor(offsetInt / limitInt) + 1;
    const includeLibraryFlag =
      includeLibrary === "true" || includeLibrary === "1";
    const scopeValue =
      scope === "all" || includeLibraryFlag ? "all" : "recommended";
    const cacheKey = `tag:${tag.toLowerCase()}:${limitInt}:${page}:${scopeValue}`;

    let recommendations = [];
    if (scopeValue === "all") {
      if (getLastfmApiKey()) {
        try {
          let data;
          if (pendingTagRequests.has(cacheKey)) {
            data = await pendingTagRequests.get(cacheKey);
          } else {
            const fetchPromise = lastfmRequest("tag.getTopArtists", {
              tag,
              limit: limitInt,
              page,
            });
            pendingTagRequests.set(cacheKey, fetchPromise);
            try {
              data = await fetchPromise;
            } finally {
              pendingTagRequests.delete(cacheKey);
            }
          }

          if (data?.topartists?.artist) {
            const artists = Array.isArray(data.topartists.artist)
              ? data.topartists.artist
              : [data.topartists.artist];

            recommendations = artists
              .map((artist) => {
                let imageUrl = null;
                if (artist.image && Array.isArray(artist.image)) {
                  const img =
                    artist.image.find((i) => i.size === "extralarge") ||
                    artist.image.find((i) => i.size === "large") ||
                    artist.image.slice(-1)[0];
                  if (
                    img &&
                    img["#text"] &&
                    !img["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
                  ) {
                    imageUrl = img["#text"];
                  }
                }

                return {
                  id: artist.mbid,
                  name: artist.name,
                  sortName: artist.name,
                  type: "Artist",
                  tags: [tag],
                  image: imageUrl,
                };
              })
              .filter((a) => a.id);
          }
        } catch (err) {
          console.error("Last.fm tag search failed:", err.message);
        }
      }
    } else {
      const userId = req.user?.id;
      const discoveryCache = userId ? getDiscoveryCache(userId) : getDiscoveryCache();
      const tagLower = String(tag).trim().toLowerCase();
      const matches = (discoveryCache.recommendations || []).filter((artist) => {
        const tags = Array.isArray(artist.tags) ? artist.tags : [];
        return tags.some((t) => String(t).toLowerCase() === tagLower);
      });
      recommendations = matches.slice(offsetInt, offsetInt + limitInt);
      return res.json({
        recommendations,
        tag,
        total: matches.length,
        offset: offsetInt,
      });
    }

    res.json({
      recommendations,
      tag,
      total: recommendations.length,
      offset: offsetInt,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to search by tag",
      message: error.message,
    });
  }
});

router.get("/preferences", (req, res) => {
  res.json(discoveryPreferences);
});

router.post("/preferences", (req, res) => {
  try {
    const updates = req.body;

    discoveryPreferences = {
      ...discoveryPreferences,
      ...updates,
    };

    res.json({
      success: true,
      preferences: discoveryPreferences,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to update preferences",
      message: error.message,
    });
  }
});

router.post("/preferences/reset", (req, res) => {
  discoveryPreferences = { ...defaultDiscoveryPreferences };
  res.json({
    success: true,
    preferences: discoveryPreferences,
  });
});

router.post("/preferences/exclude-genre", (req, res) => {
  try {
    const { genre } = req.body;
    if (!genre) {
      return res.status(400).json({ error: "genre is required" });
    }

    if (!discoveryPreferences.excludedGenres.includes(genre.toLowerCase())) {
      discoveryPreferences.excludedGenres.push(genre.toLowerCase());
    }

    res.json({
      success: true,
      excludedGenres: discoveryPreferences.excludedGenres,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to exclude genre",
      message: error.message,
    });
  }
});

router.delete("/preferences/exclude-genre/:genre", (req, res) => {
  try {
    const { genre } = req.params;
    discoveryPreferences.excludedGenres =
      discoveryPreferences.excludedGenres.filter(
        (g) => g !== genre.toLowerCase()
      );

    res.json({
      success: true,
      excludedGenres: discoveryPreferences.excludedGenres,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to remove excluded genre",
      message: error.message,
    });
  }
});

router.post("/preferences/exclude-artist", (req, res) => {
  try {
    const { artistId, artistName } = req.body;
    if (!artistId) {
      return res.status(400).json({ error: "artistId is required" });
    }

    if (
      !discoveryPreferences.excludedArtists.find((a) => a.artistId === artistId)
    ) {
      discoveryPreferences.excludedArtists.push({ artistId, artistName });
    }

    res.json({
      success: true,
      excludedArtists: discoveryPreferences.excludedArtists,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to exclude artist",
      message: error.message,
    });
  }
});

router.delete("/preferences/exclude-artist/:artistId", (req, res) => {
  try {
    const { artistId } = req.params;
    discoveryPreferences.excludedArtists =
      discoveryPreferences.excludedArtists.filter(
        (a) => a.artistId !== artistId
      );

    res.json({
      success: true,
      excludedArtists: discoveryPreferences.excludedArtists,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to remove excluded artist",
      message: error.message,
    });
  }
});

router.get("/filtered", async (req, res) => {
  try {
    const userId = req.user?.id;
    const discoveryCache = userId ? getDiscoveryCache(userId) : getDiscoveryCache();
    let recommendations = discoveryCache.recommendations || [];
    let globalTop = discoveryCache.globalTop || [];

    const libraryArtists = await libraryManager.getAllArtists();
    const existingArtistIds = new Set(libraryArtists.map((a) => a.mbid));

    recommendations = recommendations.filter(
      (artist) => !existingArtistIds.has(artist.id)
    );
    globalTop = globalTop.filter((artist) => !existingArtistIds.has(artist.id));

    if (discoveryPreferences.excludedGenres.length > 0) {
      const excludedGenresLower = discoveryPreferences.excludedGenres.map((g) =>
        g.toLowerCase()
      );

      recommendations = recommendations.filter((artist) => {
        const artistTags = (artist.tags || []).map((t) => t.toLowerCase());
        return !artistTags.some((tag) => excludedGenresLower.includes(tag));
      });

      globalTop = globalTop.filter((artist) => {
        const artistTags = (artist.tags || []).map((t) => t.toLowerCase());
        return !artistTags.some((tag) => excludedGenresLower.includes(tag));
      });
    }

    if (discoveryPreferences.excludedArtists.length > 0) {
      const excludedIds = new Set(
        discoveryPreferences.excludedArtists.map((a) => a.artistId)
      );
      recommendations = recommendations.filter(
        (artist) => !excludedIds.has(artist.id)
      );
      globalTop = globalTop.filter((artist) => !excludedIds.has(artist.id));
    }

    if (discoveryPreferences.maxRecommendations > 0) {
      recommendations = recommendations.slice(
        0,
        discoveryPreferences.maxRecommendations
      );
    }

    res.json({
      recommendations,
      globalTop,
      topTags: discoveryCache.topTags || [],
      topGenres: discoveryCache.topGenres || [],
      basedOn: discoveryCache.basedOn || [],
      lastUpdated: discoveryCache.lastUpdated,
      preferencesApplied: true,
      excludedCount: {
        genres: discoveryPreferences.excludedGenres.length,
        artists: discoveryPreferences.excludedArtists.length,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get filtered discovery",
      message: error.message,
    });
  }
});

export default router;
