// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n-context";

const getUser = vi.fn();
const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
const onAuthStateChange = vi.fn(() => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}));

vi.mock("@/lib/supabase/client", () => ({
  isSupabaseConfigured: true,
  createClient: () => ({ auth: { getUser, onAuthStateChange, signInWithOAuth } }),
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
  signInWithOAuth.mockClear();
  onAuthStateChange.mockClear();
});

describe("AuthButton", () => {
  it("shows the Kakao login button when logged out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    renderButton();
    expect(
      await screen.findByRole("button", { name: /카카오로 로그인/ }),
    ).toBeTruthy();
  });

  it("calls signInWithOAuth with the kakao provider on click", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    renderButton();
    const btn = await screen.findByRole("button", { name: /카카오로 로그인/ });
    fireEvent.click(btn);
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled());
    expect(signInWithOAuth.mock.calls[0][0].provider).toBe("kakao");
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
