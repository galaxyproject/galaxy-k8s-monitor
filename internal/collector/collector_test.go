package collector

import (
	"testing"

	"galaxy-k8s-monitor/internal/model"
)

func TestEnrichDiskFromCadvisorThreeDisks(t *testing.T) {
	raw := []byte(`
container_fs_limit_bytes{container="",device="/dev/sda1",id="/",image="",name="",namespace="",pod=""} 1.05426538496e+11 1792173542551
container_fs_limit_bytes{container="",device="/dev/sda15",id="/",image="",name="",namespace="",pod=""} 1.29718272e+08 1792173542551
container_fs_limit_bytes{container="",device="/dev/sdb",id="/",image="",name="",namespace="",pod=""} 1.67965904896e+11 1792173542551
container_fs_limit_bytes{container="",device="/dev/sdc",id="/",image="",name="",namespace="",pod=""} 1.0464022528e+10 1792173542551
container_fs_limit_bytes{container="",device="/dev/shm",id="/",image="",name="",namespace="",pod=""} 8.389771264e+09 1792173542551
container_fs_usage_bytes{container="",device="/dev/sda1",id="/",image="",name="",namespace="",pod=""} 2.0688646144e+10 1792173542551
container_fs_usage_bytes{container="",device="/dev/sda15",id="/",image="",name="",namespace="",pod=""} 1.2353536e+07 1792173542551
container_fs_usage_bytes{container="",device="/dev/sdb",id="/",image="",name="",namespace="",pod=""} 1.24652544e+10 1792173542551
container_fs_usage_bytes{container="",device="/dev/sdc",id="/",image="",name="",namespace="",pod=""} 1.62480128e+08 1792173542551
container_blkio_device_usage_total{container="nfs-server-provisioner",device="/dev/sdb",id="/kubepods",namespace="nfs-provisioner",operation="Write",pod="nfs-provisioner-nfs-server-provisioner-0"} 1.3256757248e+10 1792173513123
container_blkio_device_usage_total{container="postgres",device="/dev/sdc",id="/kubepods",namespace="galaxy",operation="Write",pod="galaxy-postgres-1"} 7.596032e+07 1792173510477
`)

	disk := &model.DiskSample{
		NodeCapacityBytes:       105426538496,
		NodeUsedBytes:           20688728064,
		NodeAvailableBytes:      80325599232,
		GalaxyPVCCapacityBytes:  167966146560,
		GalaxyPVCUsedBytes:      12465471488,
		GalaxyPVCAvailableBytes: 146893963264,
	}

	ok := enrichDiskFromCadvisor(raw, disk)
	if !ok {
		t.Fatalf("expected enrichDiskFromCadvisor to return true")
	}
	if disk.PostgresCapacityBytes != 10464022528 {
		t.Fatalf("expected PostgresCapacityBytes=10464022528, got %d", disk.PostgresCapacityBytes)
	}
	if disk.PostgresUsedBytes != 162480128 {
		t.Fatalf("expected PostgresUsedBytes=162480128, got %d", disk.PostgresUsedBytes)
	}
	expectedAvail := int64(10464022528 - 162480128)
	if disk.PostgresAvailableBytes != expectedAvail {
		t.Fatalf("expected PostgresAvailableBytes=%d, got %d", expectedAvail, disk.PostgresAvailableBytes)
	}
}

func TestEnrichDiskFromCadvisorSingleDisk(t *testing.T) {
	raw := []byte(`
container_fs_limit_bytes{container="",device="/dev/sda1",id="/",image="",name="",namespace="",pod=""} 1.05426538496e+11 1792173542551
container_fs_usage_bytes{container="",device="/dev/sda1",id="/",image="",name="",namespace="",pod=""} 2.0688646144e+10 1792173542551
container_blkio_device_usage_total{container="postgres",device="/dev/sda1",id="/kubepods",namespace="galaxy",operation="Write",pod="galaxy-postgres-1"} 7.596032e+07 1792173510477
`)

	disk := &model.DiskSample{
		NodeCapacityBytes:  105426538496,
		NodeUsedBytes:      20688728064,
		NodeAvailableBytes: 80325599232,
	}

	ok := enrichDiskFromCadvisor(raw, disk)
	if ok {
		t.Fatalf("expected enrichDiskFromCadvisor to return false on single-disk node")
	}
	if disk.PostgresCapacityBytes != 0 {
		t.Fatalf("expected PostgresCapacityBytes=0 on single-disk node, got %d", disk.PostgresCapacityBytes)
	}
}
