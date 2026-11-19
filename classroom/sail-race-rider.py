# 1:10 seated rider, rounded, no supports, PLA only (no ballast). mm; x forward, y across, z up.
# Needs manifold3d and numpy (pip, in a venv). Run: python sail-race-rider.py sail-race-rider.stl
# Prints with no supports and no ballast: slice at ~80% infill (2 walls) and tune until the slicer says 60 g.
import struct, sys, numpy as np
from manifold3d import Manifold

SEG = 48
def sph(x, y, z, r): return Manifold.sphere(r, SEG).translate([x, y, z])
def hull(*ms): return Manifold.batch_hull(list(ms))
K = 0.65  # limbs lying on the bed sit with their center 0.65 r up, so the cut-off underside is <= 45 deg

def lying(x, y, r): return sph(x, y, K * r, r)
parts = []
for s in (-1, 1):
    hip, knee, ankle = (8, 9.5 * s, 9), (50, 8 * s, 6), (86, 7.5 * s, 4.2)
    parts.append(hull(lying(*hip), lying(*knee)))                     # thigh
    parts.append(hull(lying(*knee), lying(*ankle)))                   # shin
    parts.append(hull(lying(*ankle), sph(89, 8 * s, 21, 3.6)))        # foot, toes up
    sh, el, hand = (6, 15.5 * s, 54, 5.2), (7, 18 * s, 31, 4.2), (9, 19.5 * s, 3.5 * K, 3.5)
    parts.append(hull(sph(*sh), sph(*el)))                            # upper arm
    parts.append(hull(sph(*el), sph(*hand)))                          # forearm, hand flat on the floor
torso = hull(lying(8, -9.5, 9), lying(8, 9.5, 9),                     # hips / seat
             sph(8, -7, 30, 8), sph(8, 7, 30, 8),                     # waist
             sph(8, -8, 45, 9), sph(8, 8, 45, 9),                     # chest
             sph(6, -13, 54, 6), sph(6, 13, 54, 6))                   # shoulders
parts.append(torso)
R, HC = 10, (9, 0, 74)
head = hull(sph(*HC, R), Manifold.cylinder(1, 4.8, 4.8, SEG).translate([HC[0], 0, HC[2] - R * 1.45]))
head = head.scale([1, 0.92, 1.1]).translate([0, 0, -74 * 0.1 + 0.0])  # a head is taller than wide
parts.append(Manifold.cylinder(19, 4.8, 4.8, SEG).translate([9, 0, 46]))  # neck
parts.append(head)
body = parts[0]
for p in parts[1:]: body = body + p
body = body ^ Manifold.cube([300, 300, 200]).translate([-100, -150, 0])  # flat on the bed
mn = np.asarray(body.to_mesh().vert_properties)[:, :3].min(0)
body = body.translate([-mn[0], 0, 0])

m = body.to_mesh(); V = np.asarray(m.vert_properties)[:, :3]; F = np.asarray(m.tri_verts)
a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
cr = np.cross(b - a, c - a); area = np.linalg.norm(cr, axis=1) / 2; nrm = cr / (2 * area[:, None] + 1e-12)
vol6 = np.einsum('ij,ij->i', a, np.cross(b, c)) / 6; vol = vol6.sum()
cg = ((a + b + c) / 4 * vol6[:, None]).sum(0) / vol
A = area.sum()
over = (nrm[:, 2] < -0.72) & (np.minimum(np.minimum(a[:, 2], b[:, 2]), c[:, 2]) > 0.3)
print(f"volume {vol/1000:.1f} cm3  solid PLA {vol*1.24e-3:.1f} g  surface {A/100:.0f} cm2  CG z {cg[2]:.1f} mm")
print("bbox", V.min(0).round(1), V.max(0).round(1), "status", body.status(), "tris", len(F))
print("overhang area > 45 deg:", round(area[over].sum(), 1), "mm2; worst at", V[F[over]].mean(1)[:6].round(0).tolist() if over.any() else '-')
# infill: shell = walls + top/bottom ~0.8 mm thick over the surface (2 walls of 0.4 mm, 4 layers of 0.2 mm)
for t in (0.8, 1.2):
    shell = min(vol, A * t); f = (60 / 1.24e-3 - shell) / (vol - shell)
    print(f"  shell {t} mm -> {shell/1000:.1f} cm3 of shell; infill for 60 g: {100*f:.0f}%")
with open(sys.argv[1] if len(sys.argv) > 1 else 'person.stl', 'wb') as f:
    f.write(b'Sail Race rider 1:10'.ljust(80, b' ')); f.write(struct.pack('<I', len(F)))
    for i, t in enumerate(F): f.write(struct.pack('<12fH', *nrm[i], *V[t[0]], *V[t[1]], *V[t[2]], 0))

