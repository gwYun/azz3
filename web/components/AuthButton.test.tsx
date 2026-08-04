// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n-context";

const getUser = vi.fn();
const onAuthStateChange = vi.fn(() => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));

vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: true,
  createClient: () => ({ auth: { getUser, onAuthStateChange } }),
}));

import { AuthButton } from "./AuthButton";

const renderButton = () =>
  render(
    <I18nProvider>
      <AuthButton />
    </I18nProvider>,
  );

beforeEach(() => {
  getUser.mockReset();
  onAuthStateChange.mockClear();
});

describe("AuthButton", () => {
  it("shows a Log in link to /login when logged out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    renderButton();
    const link = await screen.findByRole("link", { name: /로그인/ });
    expect(link.getAttribute("href")).toBe("/login");
  });

  it("shows the nickname and a logout control when logged in", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "u1", user_metadata: { name: "규원" } } },
    });
    renderButton();
    expect(await screen.findByText("규원")).toBeTruthy();
    expect(screen.getByRole("button", { name: /로그아웃/ })).toBeTruthy();
  });
});
