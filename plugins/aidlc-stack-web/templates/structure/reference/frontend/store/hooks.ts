import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "./index";

// ALWAYS use these typed hooks — never the bare react-redux `useDispatch`/`useSelector`.
// (`.withTypes` requires react-redux v9 / RTK v2.)
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
