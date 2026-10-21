import { describe, expect, it, vi } from "vitest";

import {
	backoffMs,
	formatValue,
	indicatorPercent,
	nextProperty,
	parseToFigma,
	parseToStreamDeck,
	PROPERTIES,
	PROPERTY_ORDER,
	stepValue,
	TickCoalescer,
	type PropertyId,
} from "../src/index";

const opacity = PROPERTIES.opacity;

describe("stepValue", () => {
	it("steps by the normal and fast step", () => {
		expect(stepValue(50, 0, 3, false, opacity)).toBe(53);
		expect(stepValue(50, 0, -2, true, opacity)).toBe(40);
	});

	it("clamps to the property range", () => {
		expect(stepValue(99, 0, 5, false, opacity)).toBe(100);
		expect(stepValue(1, 0, -5, true, opacity)).toBe(0);
	});

	it("snaps a mixed value to the fallback before stepping", () => {
		expect(stepValue("mixed", 30, 1, false, opacity)).toBe(31);
	});

	it("does not drift with fractional values", () => {
		let value = 0.1;
		for (let i = 0; i < 100; i++) value = stepValue(value, 0, 1, false, PROPERTIES.layerBlur);
		expect(value).toBe(100.1);
	});
});

describe("nextProperty", () => {
	it("skips properties the selection doesn't support", () => {
		const supported = new Set<PropertyId>(["opacity", "cornerRadius"]);
		expect(nextProperty("opacity", PROPERTY_ORDER, supported)).toBe("cornerRadius");
		expect(nextProperty("cornerRadius", PROPERTY_ORDER, supported)).toBe("opacity");
	});

	it("stays put when nothing else is supported", () => {
		expect(nextProperty("opacity", PROPERTY_ORDER, new Set())).toBe("opacity");
	});

	it("moves on from a property that isn't in the order", () => {
		expect(nextProperty("itemSpacing", ["opacity", "layerBlur"], new Set<PropertyId>(["layerBlur"]))).toBe("layerBlur");
	});
});

describe("parsing", () => {
	it("accepts valid messages and rejects junk", () => {
		expect(parseToFigma(JSON.stringify({ type: "dial", property: "opacity", ticks: -2, fast: true }))).toEqual({
			type: "dial",
			property: "opacity",
			ticks: -2,
			fast: true,
		});
		expect(parseToFigma(JSON.stringify({ type: "dial", property: "nope", ticks: 1 }))).toBeUndefined();
		expect(parseToFigma(JSON.stringify({ type: "dial", property: "opacity", ticks: 1.5 }))).toBeUndefined();
		expect(parseToFigma("not json")).toBeUndefined();
	});

	it("drops unknown properties from state", () => {
		const raw = JSON.stringify({ type: "state", fileName: "File", selectionCount: 2, values: { opacity: "mixed", bogus: 1, layerBlur: "x" } });
		expect(parseToStreamDeck(raw)).toEqual({ type: "state", fileName: "File", selectionCount: 2, values: { opacity: "mixed" } });
	});
});

describe("display helpers", () => {
	it("formats values", () => {
		expect(formatValue(42, opacity)).toBe("42%");
		expect(formatValue(4.5, PROPERTIES.cornerRadius)).toBe("4.5 px");
		expect(formatValue("mixed", opacity)).toBe("Mixed");
		expect(formatValue(undefined, opacity)).toBe("–");
	});

	it("computes the bar fill", () => {
		expect(indicatorPercent(50, opacity)).toBe(50);
		expect(indicatorPercent("mixed", opacity)).toBe(0);
		expect(indicatorPercent(500, PROPERTIES.layerBlur)).toBe(100);
	});
});

describe("backoffMs", () => {
	it("doubles and caps at 10 s", () => {
		expect([0, 1, 2, 3, 4, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
	});
});

describe("TickCoalescer", () => {
	it("merges ticks within the window into one flush", () => {
		vi.useFakeTimers();
		const flush = vi.fn();
		const coalescer = new TickCoalescer(flush, 20);
		coalescer.add(1, false);
		coalescer.add(2, true);
		coalescer.add(-1, false);
		expect(flush).not.toHaveBeenCalled();
		vi.advanceTimersByTime(20);
		expect(flush).toHaveBeenCalledExactlyOnceWith(2, true);
		vi.useRealTimers();
	});

	it("skips a flush when ticks cancel out", () => {
		vi.useFakeTimers();
		const flush = vi.fn();
		const coalescer = new TickCoalescer(flush, 20);
		coalescer.add(1, false);
		coalescer.add(-1, false);
		vi.advanceTimersByTime(20);
		expect(flush).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
});
