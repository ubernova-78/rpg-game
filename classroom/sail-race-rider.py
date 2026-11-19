# 1:10 seated rider for the Sail Race classroom test. Units: mm. x forward, y across, z up.
# Needs manifold3d and numpy (pip, in a venv). Writes sail-race-rider.stl here.
# Prints flat on its seat and legs, no supports: every overhang is 45 degrees or less.
import struct, numpy as np
from manifold3d import Manifold

def box(x0, x1, y0, y1, z0, z1):
    return Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])
def cyl(x, y, z0, z1, r0, r1=None, seg=64):
    return Manifold.cylinder(z1 - z0, r0, r0 if r1 is None else r1, seg).translate([x, y, z0])

HX = 15  # head/neck center, x
parts = [
    box(0, 22, -18, 18, 0, 10),            # pelvis / seat
    box(0, 55, -13, -3, 0, 8),             # left thigh
    box(0, 55, 3, 13, 0, 8),               # right thigh
    box(49, 84, -12.5, -3.5, 0, 6),        # left shin
    box(49, 84, 3.5, 12.5, 0, 6),          # right shin
    box(80, 86, -12.5, -3.5, 0, 14),       # left foot, toes up
    box(80, 86, 3.5, 12.5, 0, 14),         # right foot
    box(0, 20, -12, 12, 10, 50),           # torso
    box(4, 15, -16, -12, 10, 47),          # left arm (rests on the seat block)
    box(4, 15, 12, 16, 10, 47),            # right arm
    cyl(HX, 0, 50, 55, 5),                 # neck
    cyl(HX, 0, 55, 59.5, 5, 9.5),          # chin: 45-degree cone, no overhang
    cyl(HX, 0, 59.5, 71, 9.5),             # head
    cyl(HX, 0, 71, 75.5, 9.5, 5),          # crown
]
body = parts[0]
for p in parts[1:]: body = body + p
# Ballast pocket: a vertical shaft behind the neck, open at the shoulders.
# Drop steel BBs in until the rider weighs 60 g, then plug it with hot glue.
PX0, PX1, PY, PZ0 = 2, 8, 9, 3
POCKET = box(PX0, PX1, -PY, PY, PZ0, 51)
rider = body - POCKET

mesh = rider.to_mesh()
V = np.asarray(mesh.vert_properties)[:, :3]; F = np.asarray(mesh.tri_verts)

def vol_cg(V, F):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    v = np.einsum('ij,ij->i', a, np.cross(b, c)) / 6.0
    cg = ((a + b + c) / 4.0 * v[:, None]).sum(0) / v.sum()
    return v.sum(), cg
vol, cg = vol_cg(V, F)
PLA = 1.24e-3  # g/mm3
m_pla = vol * PLA
need = 60 - m_pla
bb_fill = need / 4.7e-3 / ((PX1 - PX0) * 2 * PY)  # BBs pack at ~4.7 g/cm3: mm of shaft filled
bb_cz = PZ0 + bb_fill / 2
cz = (m_pla * cg[2] + need * bb_cz) / 60
print(f"volume {vol/1000:.1f} cm3, PLA solid {m_pla:.1f} g, CG z {cg[2]:.1f} mm")
print(f"BBs needed {need:.1f} g (~{need/0.35:.0f} BBs), fill {bb_fill:.0f} mm of the shaft; rider CG z {cz:.1f} mm")
print("manifold:", rider.status() if hasattr(rider,'status') else 'n/a', "tris", len(F),
      "bbox", V.min(0).round(1), V.max(0).round(1))
with open('sail-race-rider.stl', 'wb') as f:
    f.write(b'Sail Race rider 1:10'.ljust(80, b' ')); f.write(struct.pack('<I', len(F)))
    for t in F:
        a, b, c = V[t]; n = np.cross(b - a, c - a); n = n / (np.linalg.norm(n) or 1)
        f.write(struct.pack('<12fH', *n, *a, *b, *c, 0))
