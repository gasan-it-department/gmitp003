export interface AuthUser {
  username: string;
  password: string;
}

export interface User extends Pick<AuthUser, "password" | "username"> {}
