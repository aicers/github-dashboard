import "@testing-library/jest-dom";
import "./tests/setup/resize-observer";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
