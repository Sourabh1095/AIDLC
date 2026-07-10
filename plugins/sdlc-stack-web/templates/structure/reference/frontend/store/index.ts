import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { baseApi } from "./api/base-api";
// import feature reducers here, e.g.:
// import authReducer from "./slices/auth-slice";

// ONE store. RTK Query's reducer + middleware are wired in once; feature endpoints
// attach to `baseApi` via injectEndpoints, so there's a single cache and middleware.
export const store = configureStore({
  reducer: {
    [baseApi.reducerPath]: baseApi.reducer,
    // auth: authReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(baseApi.middleware),
});

// Enables refetchOnFocus / refetchOnReconnect (opt-in per endpoint); harmless otherwise.
setupListeners(store.dispatch);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
