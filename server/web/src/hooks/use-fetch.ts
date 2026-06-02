import { useState, useCallback } from "react";
import API from "@/lib/api";

export function useFetch<T>(url: string): [T | null, boolean, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const resp = await API(url);
    const json = await resp.json();
    setData(json);
    setLoading(false);
  }, [url]);
  useState(() => { load(); });
  return [data, loading, load];
}
