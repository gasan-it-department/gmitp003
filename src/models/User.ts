export interface AuthUser {
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface User extends Pick<AuthUser, "password" | "username"> {}
