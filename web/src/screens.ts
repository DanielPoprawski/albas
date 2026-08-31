export type Screen = "splash" | "login" | "register" | "offline";

export const PATH_OF: Record<Screen, string> = {
  splash: "/",
  login: "/login",
  register: "/register",
  offline: "/offline",
};

export function screenOfPath(pathname: string): Screen {
  switch (pathname) {
    case "/login":
      return "login";
    case "/register":
      return "register";
    case "/offline":
      return "offline";
    default:
      return "splash";
  }
}
