import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

// The single RTK Query API instance. Feature endpoints live in their own files
// (store/api/<feature>-api.ts) and attach with `baseApi.injectEndpoints({...})`,
// which keeps ONE reducer, ONE middleware and ONE shared cache.
//
// Example feature file:
//   export const usersApi = baseApi.injectEndpoints({
//     endpoints: (build) => ({
//       getUser: build.query<User, string>({
//         query: (id) => `users/${id}`,
//         providesTags: (_r, _e, id) => [{ type: "User", id }],
//       }),
//     }),
//   });
//   export const { useGetUserQuery } = usersApi;
// (add "User" to `tagTypes` below for its cache invalidation to work.)
export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: "/api",
    prepareHeaders: (headers) => {
      // httpOnly-cookie auth is sent automatically; for a bearer token, read it
      // from client state (a slice) and set it here.
      return headers;
    },
  }),
  // Declare every cache tag used across features so invalidation is type-checked.
  tagTypes: [],
  endpoints: () => ({}),
});
