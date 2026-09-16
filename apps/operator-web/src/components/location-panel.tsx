'use client';

import type { LocationSample, NearbyResult } from '@/contracts/generated/api-contract';

/**
 * Bảng vị trí và điểm hỗ trợ xung quanh (W02 – cột trái).
 *
 * KHÔNG phải bản đồ thật. `MAP_PROVIDER=mock` trong Pilot, và TDD §12 quy định:
 * khi không có bản đồ, hiển thị toạ độ + địa chỉ + chỉ dẫn tiếp cận chứ không
 * chặn luồng xử lý ca. Sơ đồ SVG dưới đây chỉ thể hiện vị trí TƯƠNG ĐỐI giữa
 * hiện trường và các điểm hỗ trợ, và nói rõ điều đó trên giao diện.
 */

export interface NearbyResourceView {
  id: string;
  resourceType: string;
  name: string;
  location: { lat: number; lng: number };
  address: string | null;
  accessInstruction: string | null;
  distanceMeters: number;
}

/** Ngưỡng cảnh báo chất lượng GPS, khớp `LOW_ACCURACY_THRESHOLD_METERS` ở backend. */
const LOW_ACCURACY_THRESHOLD_METERS = 100;

const RESOURCE_LABEL: Readonly<Record<string, string>> = {
  FIRST_AID_ROOM: 'Phòng y tế',
  AED: 'Máy AED',
  ACCESS_GATE: 'Lối xe vào',
};

const SVG_SIZE = 220;
const SVG_PADDING = 24;

export function LocationPanel({
  location,
  addressText,
  accessNote,
  resources,
}: {
  location: LocationSample | null;
  addressText: string | null;
  accessNote: string | null;
  resources: NearbyResult<NearbyResourceView> | null;
}) {
  const lowAccuracy =
    location?.accuracyMeters != null && location.accuracyMeters > LOW_ACCURACY_THRESHOLD_METERS;

  return (
    <div className="panel">
      <h2>Vị trí hiện trường</h2>

      {location ? (
        <>
          <div className="mono" style={{ fontSize: 16 }}>
            {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            {location.accuracyMeters != null && (
              <span className={`badge ${lowAccuracy ? 'badge-warn' : 'badge-active'}`}>
                Sai số ±{Math.round(location.accuracyMeters)} m
              </span>
            )}
            {lowAccuracy && (
              <span className="muted">Độ chính xác thấp – hỏi thêm mốc nhận dạng</span>
            )}
          </div>
        </>
      ) : (
        <div className="error-box">
          Chưa nhận được toạ độ. Hỏi người gọi địa chỉ, số nhà, tầng và lối vào.
        </div>
      )}

      {addressText && (
        <p style={{ marginBottom: 4 }}>
          <span className="muted">Địa chỉ: </span>
          {addressText}
        </p>
      )}
      {accessNote && (
        <p style={{ margin: '4px 0' }}>
          <span className="muted">Chỉ dẫn tiếp cận: </span>
          {accessNote}
        </p>
      )}

      {location && resources && resources.items.length > 0 && (
        <>
          <RelativeSketch origin={location} resources={resources.items} />
          <p className="muted" style={{ marginTop: 4 }}>
            Sơ đồ vị trí tương đối, không phải bản đồ (MAP_PROVIDER=mock).
            {resources.spatialAccuracy === 'approximate' &&
              ' Khoảng cách tính xấp xỉ do đang chạy driver memory.'}
          </p>
        </>
      )}

      <h2 style={{ marginTop: 16 }}>Điểm hỗ trợ gần nhất</h2>
      {!resources || resources.items.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Chưa có dữ liệu điểm hỗ trợ cho khu vực này.
        </p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {resources.items.slice(0, 5).map((resource) => (
            <li key={resource.id} style={{ marginBottom: 8 }}>
              <strong>{RESOURCE_LABEL[resource.resourceType] ?? resource.resourceType}</strong> –{' '}
              {resource.name}{' '}
              <span className="muted">({resource.distanceMeters} m)</span>
              {resource.accessInstruction && (
                <div className="muted">{resource.accessInstruction}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Sơ đồ tương đối: hiện trường ở tâm, các điểm hỗ trợ đặt theo hướng và khoảng
 * cách đã chuẩn hoá. Đủ để người trực nói "AED nằm phía đông bắc, cách ~150 m".
 */
function RelativeSketch({
  origin,
  resources,
}: {
  origin: LocationSample;
  resources: NearbyResourceView[];
}) {
  const center = SVG_SIZE / 2;
  const maxDistance = Math.max(...resources.map((item) => item.distanceMeters), 1);
  const maxRadius = center - SVG_PADDING;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
      style={{ marginTop: 12, background: 'var(--bg)', borderRadius: 'var(--radius)' }}
      role="img"
      aria-label="Sơ đồ vị trí tương đối giữa hiện trường và các điểm hỗ trợ"
    >
      {[0.33, 0.66, 1].map((ratio) => (
        <circle
          key={ratio}
          cx={center}
          cy={center}
          r={maxRadius * ratio}
          fill="none"
          stroke="var(--border)"
          strokeDasharray="3 4"
        />
      ))}

      {resources.map((resource) => {
        // Quy đổi chênh lệch toạ độ sang toạ độ màn hình: lng → trục X,
        // lat → trục Y (đảo dấu vì trục Y của SVG hướng xuống).
        const deltaLng = resource.location.lng - origin.lng;
        const deltaLat = resource.location.lat - origin.lat;
        const angle = Math.atan2(-deltaLat, deltaLng);
        const radius = (resource.distanceMeters / maxDistance) * maxRadius;

        return (
          <g key={resource.id}>
            <line
              x1={center}
              y1={center}
              x2={center + radius * Math.cos(angle)}
              y2={center + radius * Math.sin(angle)}
              stroke="var(--border)"
            />
            <circle
              cx={center + radius * Math.cos(angle)}
              cy={center + radius * Math.sin(angle)}
              r={5}
              fill="var(--accent)"
            />
            <text
              x={center + radius * Math.cos(angle) + 8}
              y={center + radius * Math.sin(angle) + 4}
              fill="var(--text-muted)"
              fontSize="9"
            >
              {RESOURCE_LABEL[resource.resourceType] ?? resource.resourceType}
            </text>
          </g>
        );
      })}

      <circle cx={center} cy={center} r={7} fill="var(--urgent)" />
      <text x={center + 10} y={center + 4} fill="var(--text)" fontSize="10" fontWeight="600">
        Hiện trường
      </text>
    </svg>
  );
}
