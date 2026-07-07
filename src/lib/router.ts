import { useEffect, useState } from "react";

// 极简 hash 路由：#/ 与 #/read/:bookId

export type Route = { name: "shelf" } | { name: "read"; bookId: string };

function parse(): Route {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  const m = hash.match(/^\/read\/([^/]+)/);
  if (m) return { name: "read", bookId: decodeURIComponent(m[1]) };
  return { name: "shelf" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(to: string) {
  window.location.hash = to;
}
