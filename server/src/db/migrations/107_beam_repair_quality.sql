ALTER TABLE manufacturing_warp_beams DROP CONSTRAINT manufacturing_warp_beams_status_check;
ALTER TABLE manufacturing_warp_beams ADD CONSTRAINT manufacturing_warp_beams_status_check CHECK(status IN ('READY_FOR_SIZING','READY_FOR_WEAVING','IN_SIZING','IN_WEAVING','REJECTED','CONSUMED','NEEDS_REPAIR'));
ALTER TABLE manufacturing_warp_beams ADD COLUMN next_stage text CHECK(next_stage IN ('SIZING','WEAVING'));
ALTER TABLE manufacturing_sized_beams DROP CONSTRAINT manufacturing_sized_beams_status_check;
ALTER TABLE manufacturing_sized_beams ADD CONSTRAINT manufacturing_sized_beams_status_check CHECK(status IN ('READY_FOR_WEAVING','IN_WEAVING','REJECTED','CONSUMED','NEEDS_REPAIR'));
ALTER TABLE manufacturing_sized_beams ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE manufacturing_sizing_orders DROP CONSTRAINT manufacturing_sizing_orders_status_check;
ALTER TABLE manufacturing_sizing_orders ADD CONSTRAINT manufacturing_sizing_orders_status_check CHECK(status IN ('DRAFT','IN_PROGRESS','COMPLETED','REJECTED','CANCELLED','NEEDS_REPAIR'));
