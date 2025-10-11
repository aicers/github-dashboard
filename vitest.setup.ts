import "@testing-library/jest-dom";
import "./tests/setup/resize-observer";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import {
  installMockFetch,
  resetMockFetch,
  restoreMockFetch,
} from "./tests/setup/mock-fetch";

beforeAll(() => {
  installMockFetch();
});

afterEach(() => {
  cleanup();
  resetMockFetch();
});

afterAll(() => {
  restoreMockFetch();
});
