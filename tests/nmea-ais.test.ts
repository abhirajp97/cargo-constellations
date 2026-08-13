import assert from "node:assert/strict";
import test from "node:test";
import { NmeaAisDecoder } from "../lib/nmea-ais";

test("decodes a tagged Kystverket AIS position sentence", () => {
  const decoder = new NmeaAisDecoder();
  const [envelope] = decoder.decode("\\s:2573210,c:1786603537*00\\!BSVDM,1,1,5,A,3815bf1001PUC70Nsb0iT4a:0Dg:,0*54");
  assert.equal(envelope.MessageType, "PositionReport");
  assert.equal(envelope.MetaData?.MMSI, 538012344);
  assert.equal(envelope.MetaData?.Provider, "Norwegian Coastal Administration / Kystverket");
  assert.equal(envelope.Message.PositionReport.NavigationalStatus, 1);
  assert.ok(Math.abs(Number(envelope.Message.PositionReport.Latitude) - 54.057818) < 0.00001);
  assert.ok(Math.abs(Number(envelope.Message.PositionReport.Longitude) - 8.148) < 0.00001);
});

test("assembles and decodes multipart static vessel data", () => {
  const decoder = new NmeaAisDecoder();
  const first = "\\s:2573345,c:1786603537*01\\!BSVDM,2,1,8,B,53m>=J`2HREHhhPH000I8uV1=E10u9@E:000001;0`?550?P0:531`>L<H<e,0*29";
  const second = "\\s:2573345,c:1786603537*01\\!BSVDM,2,2,8,B,H<uuH9Pj<MP,2*18";
  assert.deepEqual(decoder.decode(first), []);
  const [envelope] = decoder.decode(second);
  assert.equal(envelope.MessageType, "ShipStaticData");
  assert.equal(envelope.MetaData?.MMSI, 257133930);
  assert.equal(envelope.Message.ShipStaticData.Name, "FROY SUPPORTER");
  assert.equal(envelope.Message.ShipStaticData.CallSign, "LLHF");
  assert.equal(envelope.Message.ShipStaticData.Type, 75);
});
