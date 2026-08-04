import { getDbRadarCounts } from "../index";
import { getSupabaseClient } from "../../storage/client";

jest.mock("../../storage/client", () => {
  const mockSelect = jest.fn();
  return {
    getSupabaseClient: jest.fn(() => ({
      from: jest.fn(() => ({
        select: mockSelect,
      })),
    })),
    __mockSelect: mockSelect,
  };
});

describe("getDbRadarCounts", () => {
  const { __mockSelect } = require("../../storage/client");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lee el estado de la tabla DB radars y no del config estático cuando están dormidos (0 activos, 12 dormidos)", async () => {
    __mockSelect.mockResolvedValueOnce({
      data: Array.from({ length: 12 }, (_, i) => ({
        key: `radar_${i}`,
        is_active: false,
      })),
      error: null,
    });

    const counts = await getDbRadarCounts();
    expect(counts).toEqual({
      active: 0,
      dormant: 12,
      total: 12,
    });
  });

  it("lee el estado de la tabla DB radars cuando todos están activos (12 activos, 0 dormidos)", async () => {
    __mockSelect.mockResolvedValueOnce({
      data: Array.from({ length: 12 }, (_, i) => ({
        key: `radar_${i}`,
        is_active: true,
      })),
      error: null,
    });

    const counts = await getDbRadarCounts();
    expect(counts).toEqual({
      active: 12,
      dormant: 0,
      total: 12,
    });
  });
});
