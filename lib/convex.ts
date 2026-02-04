import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

const resolveConvexUrl = () => {
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("CONVEX_URL is not configured");
  }
  return url;
};

export const api = anyApi;

export const getConvexClient = () => {
  return new ConvexHttpClient(resolveConvexUrl());
};
