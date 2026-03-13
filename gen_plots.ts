import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, Label
} from 'recharts';

/**
 * Data updated from the latest galaxy_usage_report.log (Feb 25)
 * Covers 90 samples at 10s intervals (15 mins)
 */
const LOG_DATA = `Monitoring started at Wed Feb 25 11:43:07 EST 2026
Config: Interval=10s, Samples=90, Total Time=15m
--- Sample 1 of 90 at Wed Feb 25 11:43:07 EST 2026 ---
No resources found in galaxy namespace.
--- Sample 2 of 90 at Wed Feb 25 11:43:18 EST 2026 ---
error: metrics not available yet
--- Sample 3 of 90 at Wed Feb 25 11:43:29 EST 2026 ---
error: metrics not available yet
--- Sample 4 of 90 at Wed Feb 25 11:43:40 EST 2026 ---
error: metrics not available yet
--- Sample 5 of 90 at Wed Feb 25 11:43:50 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-rabbitmq-server-server-0   815m         210Mi
galaxy-tusd-6f4f8785db-dfzpt      7m           9Mi
--- Sample 6 of 90 at Wed Feb 25 11:44:01 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-postgres-1                 89m          46Mi
galaxy-rabbitmq-server-server-0   809m         263Mi
galaxy-tusd-6f4f8785db-dfzpt      1m           9Mi
--- Sample 7 of 90 at Wed Feb 25 11:44:11 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-postgres-1                 89m          46Mi
galaxy-rabbitmq-server-server-0   809m         263Mi
galaxy-tusd-6f4f8785db-dfzpt      1m           9Mi
--- Sample 8 of 90 at Wed Feb 25 11:44:22 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-postgres-1                 14m          48Mi
galaxy-rabbitmq-server-server-0   489m         171Mi
galaxy-tusd-6f4f8785db-dfzpt      1m           9Mi
--- Sample 9 of 90 at Wed Feb 25 11:44:33 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-postgres-1                 10m          48Mi
galaxy-rabbitmq-server-server-0   383m         196Mi
galaxy-tusd-6f4f8785db-dfzpt      1m           9Mi
--- Sample 10 of 90 at Wed Feb 25 11:44:43 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-postgres-1                 10m          48Mi
galaxy-rabbitmq-server-server-0   383m         196Mi
galaxy-tusd-6f4f8785db-dfzpt      1m           9Mi
--- Sample 11 of 90 at Wed Feb 25 11:44:54 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-postgres-1                 11m          48Mi
galaxy-rabbitmq-server-server-0   7m           194Mi
galaxy-tusd-6f4f8785db-dfzpt      1m           9Mi
--- Sample 12 of 90 at Wed Feb 25 11:45:04 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-nginx-6997456b55-xdbqr     9m           4Mi
galaxy-postgres-1                 13m          48Mi
galaxy-rabbitmq-server-server-0   5m           194Mi
galaxy-tusd-6f4f8785db-dfzpt      1m           9Mi
--- Sample 13 of 90 at Wed Feb 25 11:45:15 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-nginx-6997456b55-xdbqr     0m           4Mi
galaxy-postgres-1                 8m           48Mi
galaxy-rabbitmq-server-server-0   5m           194Mi
galaxy-tusd-6f4f8785db-dfzpt      1m           9Mi
--- Sample 14 of 90 at Wed Feb 25 11:45:25 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-nginx-6997456b55-xdbqr     0m           4Mi
galaxy-postgres-1                 8m           48Mi
galaxy-rabbitmq-server-server-0   5m           194Mi
galaxy-tusd-6f4f8785db-dfzpt      1m           9Mi
--- Sample 15 of 90 at Wed Feb 25 11:45:36 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-init-mounts-gwdhj-c5nfv    1109m        32Mi
galaxy-nginx-6997456b55-xdbqr     0m           4Mi
galaxy-postgres-1                 15m          50Mi
galaxy-rabbitmq-server-server-0   25m          194Mi
galaxy-tusd-6f4f8785db-dfzpt      1m           9Mi
--- Sample 16 of 90 at Wed Feb 25 11:45:46 EST 2026 ---
NAME                              CPU(cores)   MEMORY(bytes)
galaxy-init-mounts-gwdhj-c5nfv    948m         40Mi
galaxy-nginx-6997456b55-xdbqr     0m           4Mi
galaxy-postgres-1                 11m          50Mi
galaxy-rabbitmq-server-server-0   6m           194Mi
galaxy-tusd-6f4f8785db-dfzpt      1m           10Mi
--- Sample 17 of 90 at Wed Feb 25 11:45:57 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        5m           0Mi
galaxy-celery-beat-746977667b-w85m8   4m           0Mi
galaxy-init-mounts-gwdhj-c5nfv        948m         40Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     11m          50Mi
galaxy-rabbitmq-server-server-0       6m           194Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           5m           0Mi
--- Sample 18 of 90 at Wed Feb 25 11:46:07 EST 2026 ---
NAME                               CPU(cores)   MEMORY(bytes)
galaxy-init-mounts-gwdhj-c5nfv     328m         30Mi
galaxy-nginx-6997456b55-xdbqr      0m           4Mi
galaxy-postgres-1                  17m          50Mi
galaxy-rabbitmq-server-server-0    5m           194Mi
galaxy-tusd-6f4f8785db-dfzpt       1m           10Mi
galaxy-workflow-5c887f4d9c-wxdjk   5m           0Mi
galaxy-workflow-dbb94d476-b87g7    5m           0Mi
--- Sample 19 of 90 at Wed Feb 25 11:46:18 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        772m         203Mi
galaxy-celery-beat-746977667b-w85m8   758m         154Mi
galaxy-init-mounts-gwdhj-c5nfv        46m          30Mi
galaxy-job-0-58dd8b8b8d-8fbjv         921m         244Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     9m           50Mi
galaxy-rabbitmq-server-server-0       5m           194Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           848m         221Mi
--- Sample 20 of 90 at Wed Feb 25 11:46:28 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        402m         304Mi
galaxy-celery-beat-746977667b-w85m8   211m         218Mi
galaxy-init-mounts-gwdhj-c5nfv        9m           30Mi
galaxy-job-0-58dd8b8b8d-8fbjv         973m         266Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     12m          50Mi
galaxy-rabbitmq-server-server-0       31m          194Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-workflow-5c887f4d9c-wxdjk      711m         166Mi
galaxy-workflow-dbb94d476-b87g7       586m         148Mi
--- Sample 21 of 90 at Wed Feb 25 11:46:39 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        402m         304Mi
galaxy-celery-beat-746977667b-w85m8   211m         218Mi
galaxy-init-mounts-gwdhj-c5nfv        9m           30Mi
galaxy-job-0-58dd8b8b8d-8fbjv         973m         266Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     12m          50Mi
galaxy-rabbitmq-server-server-0       31m          194Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-workflow-5c887f4d9c-wxdjk      711m         166Mi
galaxy-workflow-dbb94d476-b87g7       586m         148Mi
--- Sample 22 of 90 at Wed Feb 25 11:46:49 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        402m         304Mi
galaxy-celery-beat-746977667b-w85m8   211m         218Mi
galaxy-init-mounts-gwdhj-c5nfv        22m          31Mi
galaxy-job-0-58dd8b8b8d-8fbjv         421m         420Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     140m         86Mi
galaxy-rabbitmq-server-server-0       9m           194Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           941m         277Mi
galaxy-workflow-5c887f4d9c-wxdjk      721m         346Mi
galaxy-workflow-dbb94d476-b87g7       715m         449Mi
--- Sample 23 of 90 at Wed Feb 25 11:47:00 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        133m         360Mi
galaxy-celery-beat-746977667b-w85m8   433m         350Mi
galaxy-init-mounts-gwdhj-c5nfv        149m         32Mi
galaxy-job-0-58dd8b8b8d-8fbjv         372m         443Mi
galaxy-nginx-6997456b55-xdbqr         1m           4Mi
galaxy-postgres-1                     16m          86Mi
galaxy-rabbitmq-server-server-0       6m           194Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           799m         285Mi
galaxy-workflow-5c887f4d9c-wxdjk      574m         462Mi
galaxy-workflow-dbb94d476-b87g7       696m         510Mi
--- Sample 24 of 90 at Wed Feb 25 11:47:10 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        133m         360Mi
galaxy-celery-beat-746977667b-w85m8   433m         350Mi
galaxy-init-mounts-gwdhj-c5nfv        149m         32Mi
galaxy-job-0-58dd8b8b8d-8fbjv         372m         443Mi
galaxy-nginx-6997456b55-xdbqr         1m           4Mi
galaxy-postgres-1                     16m          86Mi
galaxy-rabbitmq-server-server-0       6m           194Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           799m         285Mi
galaxy-workflow-5c887f4d9c-wxdjk      574m         462Mi
galaxy-workflow-dbb94d476-b87g7       696m         510Mi
--- Sample 25 of 90 at Wed Feb 25 11:47:21 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        129m         32Mi
galaxy-job-0-58dd8b8b8d-8fbjv         661m         523Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     30m          93Mi
galaxy-rabbitmq-server-server-0       6m           194Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           770m         517Mi
galaxy-workflow-5c887f4d9c-wxdjk      620m         574Mi
galaxy-workflow-dbb94d476-b87g7       310m         535Mi
--- Sample 26 of 90 at Wed Feb 25 11:47:31 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        186m         34Mi
galaxy-job-0-58dd8b8b8d-8fbjv         639m         623Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     23m          93Mi
galaxy-rabbitmq-server-server-0       30m          195Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           725m         595Mi
galaxy-workflow-5c887f4d9c-wxdjk      662m         638Mi
galaxy-workflow-dbb94d476-b87g7       699m         625Mi
--- Sample 27 of 90 at Wed Feb 25 11:47:42 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        186m         34Mi
galaxy-job-0-58dd8b8b8d-8fbjv         639m         623Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     23m          93Mi
galaxy-rabbitmq-server-server-0       30m          195Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           725m         595Mi
galaxy-workflow-5c887f4d9c-wxdjk      662m         638Mi
galaxy-workflow-dbb94d476-b87g7       699m         625Mi
--- Sample 28 of 90 at Wed Feb 25 11:47:52 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        140m         35Mi
galaxy-job-0-58dd8b8b8d-8fbjv         426m         653Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     16m          93Mi
galaxy-rabbitmq-server-server-0       6m           194Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           672m         641Mi
galaxy-workflow-5c887f4d9c-wxdjk      708m         745Mi
galaxy-workflow-dbb94d476-b87g7       769m         719Mi
--- Sample 29 of 90 at Wed Feb 25 11:48:03 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        124m         36Mi
galaxy-job-0-58dd8b8b8d-8fbjv         619m         761Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     22m          95Mi
galaxy-rabbitmq-server-server-0       6m           194Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           653m         715Mi
galaxy-workflow-5c887f4d9c-wxdjk      708m         745Mi
galaxy-workflow-dbb94d476-b87g7       665m         784Mi
--- Sample 30 of 90 at Wed Feb 25 11:48:13 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        161m         37Mi
galaxy-job-0-58dd8b8b8d-8fbjv         532m         805Mi
galaxy-nginx-6997456b55-xdbqr         1m           4Mi
galaxy-postgres-1                     23m          103Mi
galaxy-rabbitmq-server-server-0       10m          195Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           686m         812Mi
galaxy-workflow-5c887f4d9c-wxdjk      467m         801Mi
--- Sample 31 of 90 at Wed Feb 25 11:48:24 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        161m         37Mi
galaxy-job-0-58dd8b8b8d-8fbjv         532m         805Mi
galaxy-nginx-6997456b55-xdbqr         1m           4Mi
galaxy-postgres-1                     23m          103Mi
galaxy-rabbitmq-server-server-0       10m          195Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           686m         812Mi
galaxy-workflow-5c887f4d9c-wxdjk      467m         801Mi
--- Sample 32 of 90 at Wed Feb 25 11:48:35 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        310m         23Mi
galaxy-job-0-58dd8b8b8d-8fbjv         259m         812Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     34m          95Mi
galaxy-rabbitmq-server-server-0       33m          197Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           930m         897Mi
galaxy-workflow-5c887f4d9c-wxdjk      467m         801Mi
--- Sample 33 of 90 at Wed Feb 25 11:48:45 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        462m         26Mi
galaxy-job-0-58dd8b8b8d-8fbjv         119m         812Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     27m          95Mi
galaxy-rabbitmq-server-server-0       7m           197Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           994m         1136Mi
galaxy-workflow-5c887f4d9c-wxdjk      122m         800Mi
--- Sample 34 of 90 at Wed Feb 25 11:48:55 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        462m         26Mi
galaxy-job-0-58dd8b8b8d-8fbjv         119m         812Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     27m          95Mi
galaxy-rabbitmq-server-server-0       7m           197Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           994m         1136Mi
galaxy-workflow-5c887f4d9c-wxdjk      122m         800Mi
--- Sample 35 of 90 at Wed Feb 25 11:49:06 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        384m         29Mi
galaxy-job-0-58dd8b8b8d-8fbjv         117m         812Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     39m          96Mi
galaxy-rabbitmq-server-server-0       6m           197Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           991m         1381Mi
galaxy-workflow-5c887f4d9c-wxdjk      122m         800Mi
--- Sample 36 of 90 at Wed Feb 25 11:49:16 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        410m         31Mi
galaxy-job-0-58dd8b8b8d-8fbjv         213m         812Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     27m          96Mi
galaxy-rabbitmq-server-server-0       8m           197Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           990m         1513Mi
galaxy-workflow-5c887f4d9c-wxdjk      105m         802Mi
--- Sample 37 of 90 at Wed Feb 25 11:49:27 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        410m         31Mi
galaxy-job-0-58dd8b8b8d-8fbjv         213m         812Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     27m          96Mi
galaxy-rabbitmq-server-server-0       8m           197Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           990m         1513Mi
galaxy-workflow-5c887f4d9c-wxdjk      105m         802Mi
--- Sample 38 of 90 at Wed Feb 25 11:49:37 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        474m         33Mi
galaxy-job-0-58dd8b8b8d-8fbjv         213m         812Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     37m          98Mi
galaxy-rabbitmq-server-server-0       52m          197Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           695m         1753Mi
galaxy-workflow-5c887f4d9c-wxdjk      155m         801Mi
--- Sample 39 of 90 at Wed Feb 25 11:49:48 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        3m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        127m         34Mi
galaxy-job-0-58dd8b8b8d-8fbjv         122m         821Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     55m          98Mi
galaxy-rabbitmq-server-server-0       13m          196Mi
galaxy-tusd-6f4f8785db-dfzpt          2m           9Mi
galaxy-web-5df98595dd-vwml5           695m         1753Mi
galaxy-workflow-5c887f4d9c-wxdjk      231m         801Mi
--- Sample 40 of 90 at Wed Feb 25 11:49:58 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        292m         35Mi
galaxy-job-0-58dd8b8b8d-8fbjv         233m         811Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     40m          98Mi
galaxy-rabbitmq-server-server-0       9m           192Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           942m         1786Mi
galaxy-workflow-5c887f4d9c-wxdjk      137m         811Mi
--- Sample 41 of 90 at Wed Feb 25 11:50:09 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        292m         35Mi
galaxy-job-0-58dd8b8b8d-8fbjv         233m         811Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     40m          98Mi
galaxy-rabbitmq-server-server-0       9m           192Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           942m         1786Mi
galaxy-workflow-5c887f4d9c-wxdjk      137m         811Mi
--- Sample 42 of 90 at Wed Feb 25 11:50:19 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        328m         38Mi
galaxy-job-0-58dd8b8b8d-8fbjv         157m         810Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     37m          100Mi
galaxy-rabbitmq-server-server-0       7m           192Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           1009m        1787Mi
galaxy-workflow-5c887f4d9c-wxdjk      137m         811Mi
--- Sample 43 of 90 at Wed Feb 25 11:50:30 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        193m         41Mi
galaxy-job-0-58dd8b8b8d-8fbjv         179m         810Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     35m          100Mi
galaxy-rabbitmq-server-server-0       40m          193Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           221m         1790Mi
galaxy-workflow-5c887f4d9c-wxdjk      120m         801Mi
--- Sample 44 of 90 at Wed Feb 25 11:50:40 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        193m         41Mi
galaxy-job-0-58dd8b8b8d-8fbjv         179m         810Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     35m          100Mi
galaxy-rabbitmq-server-server-0       40m          193Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           221m         1790Mi
galaxy-workflow-5c887f4d9c-wxdjk      120m         801Mi
--- Sample 45 of 90 at Wed Feb 25 11:50:51 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        290m         44Mi
galaxy-job-0-58dd8b8b8d-8fbjv         313m         827Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     42m          101Mi
galaxy-rabbitmq-server-server-0       10m          193Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           255m         1823Mi
galaxy-workflow-5c887f4d9c-wxdjk      212m         818Mi
--- Sample 46 of 90 at Wed Feb 25 11:51:01 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        286m         47Mi
galaxy-job-0-58dd8b8b8d-8fbjv         140m         837Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     29m          101Mi
galaxy-rabbitmq-server-server-0       7m           193Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           91m          1823Mi
galaxy-workflow-5c887f4d9c-wxdjk      222m         818Mi
--- Sample 47 of 90 at Wed Feb 25 11:51:12 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        286m         47Mi
galaxy-job-0-58dd8b8b8d-8fbjv         140m         837Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     29m          101Mi
galaxy-rabbitmq-server-server-0       7m           193Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           91m          1823Mi
galaxy-workflow-5c887f4d9c-wxdjk      222m         818Mi
--- Sample 48 of 90 at Wed Feb 25 11:51:22 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        184m         51Mi
galaxy-job-0-58dd8b8b8d-8fbjv         286m         833Mi
galaxy-nginx-6997456b55-xdbqr         0m           4Mi
galaxy-postgres-1                     51m          104Mi
galaxy-rabbitmq-server-server-0       11m          193Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           261m         1825Mi
galaxy-workflow-5c887f4d9c-wxdjk      119m         817Mi
--- Sample 49 of 90 at Wed Feb 25 11:51:33 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        94m          53Mi
galaxy-job-0-58dd8b8b8d-8fbjv         565m         844Mi
galaxy-nginx-6997456b55-xdbqr         39m          5Mi
galaxy-postgres-1                     90m          118Mi
galaxy-rabbitmq-server-server-0       11m          193Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           370m         1864Mi
galaxy-workflow-5c887f4d9c-wxdjk      517m         835Mi
--- Sample 50 of 90 at Wed Feb 25 11:51:43 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        270m         55Mi
galaxy-job-0-58dd8b8b8d-8fbjv         1225m        890Mi
galaxy-nginx-6997456b55-xdbqr         2m           5Mi
galaxy-postgres-1                     52m          126Mi
galaxy-rabbitmq-server-server-0       27m          192Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           370m         1864Mi
galaxy-workflow-5c887f4d9c-wxdjk      517m         835Mi
--- Sample 51 of 90 at Wed Feb 25 11:51:54 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        270m         55Mi
galaxy-job-0-58dd8b8b8d-8fbjv         1225m        890Mi
galaxy-nginx-6997456b55-xdbqr         2m           5Mi
galaxy-postgres-1                     52m          126Mi
galaxy-rabbitmq-server-server-0       27m          192Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           9Mi
galaxy-web-5df98595dd-vwml5           370m         1864Mi
galaxy-workflow-5c887f4d9c-wxdjk      517m         835Mi
--- Sample 52 of 90 at Wed Feb 25 11:52:04 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        120m         58Mi
galaxy-job-0-58dd8b8b8d-8fbjv         1127m        1116Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     26m          127Mi
galaxy-rabbitmq-server-server-0       7m           192Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           252m         1878Mi
galaxy-workflow-5c887f4d9c-wxdjk      316m         840Mi
--- Sample 53 of 90 at Wed Feb 25 11:52:15 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        401m         61Mi
galaxy-job-0-58dd8b8b8d-8fbjv         1138m        1052Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     56m          128Mi
galaxy-rabbitmq-server-server-0       9m           192Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           110m         1877Mi
galaxy-workflow-5c887f4d9c-wxdjk      139m         840Mi
--- Sample 54 of 90 at Wed Feb 25 11:52:25 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        401m         61Mi
galaxy-job-0-58dd8b8b8d-8fbjv         1138m        1052Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     56m          128Mi
galaxy-rabbitmq-server-server-0       9m           192Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           110m         1877Mi
galaxy-workflow-5c887f4d9c-wxdjk      139m         840Mi
--- Sample 55 of 90 at Wed Feb 25 11:52:36 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        223m         63Mi
galaxy-job-0-58dd8b8b8d-8fbjv         1138m        1052Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     31m          128Mi
galaxy-rabbitmq-server-server-0       45m          192Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           234m         1878Mi
galaxy-workflow-5c887f4d9c-wxdjk      333m         846Mi
--- Sample 56 of 90 at Wed Feb 25 11:52:46 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        438m         66Mi
galaxy-job-0-58dd8b8b8d-8fbjv         861m         882Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     31m          128Mi
galaxy-rabbitmq-server-server-0       7m           191Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           101m         1878Mi
galaxy-workflow-5c887f4d9c-wxdjk      120m         846Mi
--- Sample 57 of 90 at Wed Feb 25 11:52:57 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        438m         66Mi
galaxy-job-0-58dd8b8b8d-8fbjv         861m         882Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     31m          128Mi
galaxy-rabbitmq-server-server-0       7m           191Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           101m         1878Mi
galaxy-workflow-5c887f4d9c-wxdjk      120m         846Mi
--- Sample 58 of 90 at Wed Feb 25 11:53:07 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        439m         69Mi
galaxy-job-0-58dd8b8b8d-8fbjv         134m         872Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     28m          128Mi
galaxy-rabbitmq-server-server-0       8m           191Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           108m         1878Mi
galaxy-workflow-5c887f4d9c-wxdjk      117m         845Mi
--- Sample 59 of 90 at Wed Feb 25 11:53:18 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        248m         70Mi
galaxy-job-0-58dd8b8b8d-8fbjv         122m         887Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     30m          128Mi
galaxy-rabbitmq-server-server-0       7m           191Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           99m          1877Mi
galaxy-workflow-5c887f4d9c-wxdjk      116m         845Mi
--- Sample 60 of 90 at Wed Feb 25 11:53:28 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        545m         76Mi
galaxy-job-0-58dd8b8b8d-8fbjv         138m         883Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     28m          128Mi
galaxy-rabbitmq-server-server-0       29m          190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           107m         1878Mi
galaxy-workflow-5c887f4d9c-wxdjk      116m         845Mi
--- Sample 61 of 90 at Wed Feb 25 11:53:39 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        545m         76Mi
galaxy-job-0-58dd8b8b8d-8fbjv         138m         883Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     28m          128Mi
galaxy-rabbitmq-server-server-0       29m          190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           107m         1878Mi
galaxy-workflow-5c887f4d9c-wxdjk      116m         845Mi
--- Sample 62 of 90 at Wed Feb 25 11:53:49 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        329m         80Mi
galaxy-job-0-58dd8b8b8d-8fbjv         177m         872Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     30m          128Mi
galaxy-rabbitmq-server-server-0       8m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           117m         1878Mi
galaxy-workflow-5c887f4d9c-wxdjk      112m         852Mi
--- Sample 63 of 90 at Wed Feb 25 11:54:00 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        322m         82Mi
galaxy-job-0-58dd8b8b8d-8fbjv         337m         877Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     30m          128Mi
galaxy-rabbitmq-server-server-0       9m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           310m         1884Mi
galaxy-workflow-5c887f4d9c-wxdjk      398m         850Mi
--- Sample 64 of 90 at Wed Feb 25 11:54:10 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        322m         82Mi
galaxy-job-0-58dd8b8b8d-8fbjv         337m         877Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     30m          128Mi
galaxy-rabbitmq-server-server-0       9m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           310m         1884Mi
galaxy-workflow-5c887f4d9c-wxdjk      398m         850Mi
--- Sample 65 of 90 at Wed Feb 25 11:54:20 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        121m         85Mi
galaxy-job-0-58dd8b8b8d-8fbjv         356m         883Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     51m          129Mi
galaxy-rabbitmq-server-server-0       10m          190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           375m         1888Mi
galaxy-workflow-5c887f4d9c-wxdjk      419m         852Mi
--- Sample 66 of 90 at Wed Feb 25 11:54:31 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        490m         88Mi
galaxy-job-0-58dd8b8b8d-8fbjv         291m         890Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     45m          129Mi
galaxy-rabbitmq-server-server-0       45m          190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           259m         1888Mi
galaxy-workflow-5c887f4d9c-wxdjk      408m         853Mi
--- Sample 67 of 90 at Wed Feb 25 11:54:41 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        490m         88Mi
galaxy-job-0-58dd8b8b8d-8fbjv         291m         890Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     45m          129Mi
galaxy-rabbitmq-server-server-0       45m          190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           259m         1888Mi
galaxy-workflow-5c887f4d9c-wxdjk      408m         853Mi
--- Sample 68 of 90 at Wed Feb 25 11:54:52 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        216m         89Mi
galaxy-job-0-58dd8b8b8d-8fbjv         203m         893Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     45m          129Mi
galaxy-rabbitmq-server-server-0       10m          191Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           281m         1888Mi
galaxy-workflow-5c887f4d9c-wxdjk      408m         853Mi
--- Sample 69 of 90 at Wed Feb 25 11:55:02 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        254m         93Mi
galaxy-job-0-58dd8b8b8d-8fbjv         330m         896Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     42m          129Mi
galaxy-rabbitmq-server-server-0       10m          191Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           197m         1889Mi
galaxy-workflow-5c887f4d9c-wxdjk      328m         854Mi
--- Sample 70 of 90 at Wed Feb 25 11:55:13 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        254m         93Mi
galaxy-job-0-58dd8b8b8d-8fbjv         330m         896Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     42m          129Mi
galaxy-rabbitmq-server-server-0       10m          191Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           197m         1889Mi
galaxy-workflow-5c887f4d9c-wxdjk      328m         854Mi
--- Sample 71 of 90 at Wed Feb 25 11:55:23 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        268m         95Mi
galaxy-job-0-58dd8b8b8d-8fbjv         352m         902Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     32m          129Mi
galaxy-rabbitmq-server-server-0       7m           191Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           211m         1888Mi
galaxy-workflow-5c887f4d9c-wxdjk      108m         853Mi
--- Sample 72 of 90 at Wed Feb 25 11:55:34 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        231m         98Mi
galaxy-job-0-58dd8b8b8d-8fbjv         381m         908Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     55m          129Mi
galaxy-rabbitmq-server-server-0       41m          191Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           332m         1889Mi
galaxy-workflow-5c887f4d9c-wxdjk      344m         852Mi
--- Sample 73 of 90 at Wed Feb 25 11:55:44 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        318m         103Mi
galaxy-job-0-58dd8b8b8d-8fbjv         320m         908Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     27m          129Mi
galaxy-rabbitmq-server-server-0       9m           191Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           245m         1889Mi
galaxy-workflow-5c887f4d9c-wxdjk      385m         852Mi
--- Sample 74 of 90 at Wed Feb 25 11:55:55 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        318m         103Mi
galaxy-job-0-58dd8b8b8d-8fbjv         320m         908Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     27m          129Mi
galaxy-rabbitmq-server-server-0       9m           191Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           245m         1889Mi
galaxy-workflow-5c887f4d9c-wxdjk      385m         852Mi
--- Sample 75 of 90 at Wed Feb 25 11:56:05 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        315m         106Mi
galaxy-job-0-58dd8b8b8d-8fbjv         155m         908Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     28m          129Mi
galaxy-rabbitmq-server-server-0       7m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           116m         1888Mi
galaxy-workflow-5c887f4d9c-wxdjk      97m          852Mi
--- Sample 76 of 90 at Wed Feb 25 11:56:15 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        253m         109Mi
galaxy-job-0-58dd8b8b8d-8fbjv         347m         909Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     46m          129Mi
galaxy-rabbitmq-server-server-0       9m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           116m         1888Mi
galaxy-workflow-5c887f4d9c-wxdjk      286m         853Mi
--- Sample 77 of 90 at Wed Feb 25 11:56:26 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-init-mounts-gwdhj-c5nfv        253m         109Mi
galaxy-job-0-58dd8b8b8d-8fbjv         347m         909Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     46m          129Mi
galaxy-rabbitmq-server-server-0       9m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           116m         1888Mi
galaxy-workflow-5c887f4d9c-wxdjk      286m         853Mi
--- Sample 78 of 90 at Wed Feb 25 11:56:36 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         347m         909Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     32m          129Mi
galaxy-rabbitmq-server-server-0       9m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           304m         1886Mi
galaxy-workflow-5c887f4d9c-wxdjk      436m         854Mi
--- Sample 79 of 90 at Wed Feb 25 11:56:47 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         304m         909Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     51m          129Mi
galaxy-rabbitmq-server-server-0       31m          190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           440m         1885Mi
galaxy-workflow-5c887f4d9c-wxdjk      203m         857Mi
--- Sample 80 of 90 at Wed Feb 25 11:56:57 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           360Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         304m         909Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     51m          129Mi
galaxy-rabbitmq-server-server-0       31m          190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           440m         1885Mi
galaxy-workflow-5c887f4d9c-wxdjk      203m         857Mi
--- Sample 81 of 90 at Wed Feb 25 11:57:08 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        195m         432Mi
galaxy-celery-beat-746977667b-w85m8   3m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         389m         911Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     31m          129Mi
galaxy-rabbitmq-server-server-0       10m          190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           88m          1885Mi
galaxy-workflow-5c887f4d9c-wxdjk      353m         859Mi
--- Sample 82 of 90 at Wed Feb 25 11:57:18 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           432Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         112m         911Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     21m          129Mi
galaxy-rabbitmq-server-server-0       6m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           88m          1885Mi
galaxy-workflow-5c887f4d9c-wxdjk      77m          859Mi
--- Sample 83 of 90 at Wed Feb 25 11:57:29 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           432Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         114m         911Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     29m          129Mi
galaxy-rabbitmq-server-server-0       6m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           85m          1885Mi
galaxy-workflow-5c887f4d9c-wxdjk      103m         859Mi
--- Sample 84 of 90 at Wed Feb 25 11:57:39 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           432Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         114m         911Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     29m          129Mi
galaxy-rabbitmq-server-server-0       6m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           85m          1885Mi
galaxy-workflow-5c887f4d9c-wxdjk      103m         859Mi
--- Sample 85 of 90 at Wed Feb 25 11:57:50 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           432Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         80m          918Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     25m          129Mi
galaxy-rabbitmq-server-server-0       21m          190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           97m          1885Mi
galaxy-workflow-5c887f4d9c-wxdjk      92m          859Mi
--- Sample 86 of 90 at Wed Feb 25 11:58:00 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           432Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         175m         921Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     25m          129Mi
galaxy-rabbitmq-server-server-0       7m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           97m          1885Mi
galaxy-workflow-5c887f4d9c-wxdjk      110m         870Mi
--- Sample 87 of 90 at Wed Feb 25 11:58:11 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           432Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         175m         921Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     25m          129Mi
galaxy-rabbitmq-server-server-0       7m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           97m          1885Mi
galaxy-workflow-5c887f4d9c-wxdjk      110m         870Mi
--- Sample 88 of 90 at Wed Feb 25 11:58:21 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           432Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         93m          911Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     22m          129Mi
galaxy-rabbitmq-server-server-0       7m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           85m          1885Mi
galaxy-workflow-5c887f4d9c-wxdjk      83m          860Mi
--- Sample 89 of 90 at Wed Feb 25 11:58:31 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           432Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         115m         911Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     30m          129Mi
galaxy-rabbitmq-server-server-0       7m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           82m          1884Mi
galaxy-workflow-5c887f4d9c-wxdjk      116m         860Mi
--- Sample 90 of 90 at Wed Feb 25 11:58:42 EST 2026 ---
NAME                                  CPU(cores)   MEMORY(bytes)
galaxy-celery-6959d5cd9f-nkdlh        1m           432Mi
galaxy-celery-beat-746977667b-w85m8   1m           350Mi
galaxy-job-0-58dd8b8b8d-8fbjv         115m         911Mi
galaxy-nginx-6997456b55-xdbqr         1m           5Mi
galaxy-postgres-1                     30m          129Mi
galaxy-rabbitmq-server-server-0       7m           190Mi
galaxy-tusd-6f4f8785db-dfzpt          1m           10Mi
galaxy-web-5df98595dd-vwml5           82m          1884Mi
galaxy-workflow-5c887f4d9c-wxdjk      116m         860Mi
`;

const timeToSeconds = (timeStr) => {
  const [h, m, s] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

const formatRelativeTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const parseLogs = (logText) => {
  const samples = logText.split(/--- Sample \d+ of \d+ at /);
  const data = [];
  const podNamesSet = new Set();
  let startSeconds = null;

  samples.shift();

  samples.forEach((sample) => {
    const lines = sample.split('\n');
    const timestampMatch = lines[0].match(/(\d{2}:\d{2}:\d{2})/);
    const rawTimestamp = timestampMatch ? timestampMatch[1] : null;

    if (!rawTimestamp) return;

    const currentSeconds = timeToSeconds(rawTimestamp);
    if (startSeconds === null) startSeconds = currentSeconds;
    const relativeTime = formatRelativeTime(currentSeconds - startSeconds);

    const entry = {
      timestamp: rawTimestamp,
      relativeTime,
      total_cpu: 0,
      total_memory: 0
    };

    let tableStarted = false;

    lines.forEach(line => {
      if (line.includes('NAME') && line.includes('CPU')) {
        tableStarted = true;
        return;
      }

      if (tableStarted && line.trim()) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const rawName = parts[0];

          // Improved Name Cleaning: Aggregates resources by functional group
          let shortName = rawName;
          if (rawName.includes('galaxy-celery-beat')) shortName = 'galaxy-celery-beat';
          else if (rawName.includes('galaxy-celery')) shortName = 'galaxy-celery';
          else if (rawName.includes('galaxy-nginx')) shortName = 'galaxy-nginx';
          else if (rawName.includes('galaxy-postgres')) shortName = 'galaxy-postgres';
          else if (rawName.includes('galaxy-rabbitmq')) shortName = 'galaxy-rabbitmq';
          else if (rawName.includes('galaxy-tusd')) shortName = 'galaxy-tusd';
          else if (rawName.includes('galaxy-web')) shortName = 'galaxy-web';
          else if (rawName.includes('galaxy-workflow')) shortName = 'galaxy-workflow';
          else if (rawName.includes('galaxy-init-mounts')) shortName = 'galaxy-init-mounts';
          else if (rawName.includes('galaxy-job')) shortName = 'galaxy-job';

          podNamesSet.add(shortName);
          const cpu = parseInt(parts[1].replace('m', '')) || 0;
          const memoryMiB = parseInt(parts[2].replace('Mi', '')) || 0;
          const memoryGB = parseFloat((memoryMiB / 1024).toFixed(3));

          // Aggregating by shortName (e.g. summing all web pods together)
          entry[`${shortName}_cpu`] = (entry[`${shortName}_cpu`] || 0) + cpu;
          entry[`${shortName}_memory`] = parseFloat(((entry[`${shortName}_memory`] || 0) + memoryGB).toFixed(3));

          entry.total_cpu += cpu;
          entry.total_memory = parseFloat((entry.total_memory + memoryGB).toFixed(3));
        }
      }
    });

    if (Object.keys(entry).length > 4) {
      data.push(entry);
    }
  });

  return { data, podNames: Array.from(podNamesSet) };
};

const COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed',
  '#db2777', '#0891b2', '#4f46e5', '#ca8a04', '#059669'
];

/**
 * Custom Tooltip Component: Fixes validateDOMNesting and displays total usage prominently.
 */
const CustomTooltip = ({ active, payload, label, unit, metric }) => {
  if (active && payload && payload.length) {
    const dataPoint = payload[0].payload;
    const total = dataPoint[`total_${metric}`];

    // Sort items by value descending for readability in tooltip
    const sortedPayload = [...payload].sort((a, b) => b.value - a.value);

    return (
      <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-xl pointer-events-none min-w-[220px]">
        <div className="mb-2 pb-2 border-b border-slate-100">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest text-left">Elapsed Time</div>
          <div className="text-sm font-bold text-slate-900 text-left">{label}</div>
          <div className="mt-2 py-1.5 px-2 bg-blue-50 rounded-lg flex justify-between items-center">
            <span className="text-[10px] font-black text-blue-600 uppercase">Cluster Total</span>
            <span className="text-sm font-bold text-blue-700">{total}{unit}</span>
          </div>
        </div>
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
          {sortedPayload.map((entry, index) => (
            <div key={index} className="flex justify-between items-center gap-4 text-[11px]">
              <div className="flex items-center gap-2 overflow-hidden">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                <span className="text-slate-600 truncate">{entry.name}</span>
              </div>
              <span className="font-mono font-bold text-slate-900 shrink-0">
                {entry.value}{unit}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export default function App() {
  const [metric, setMetric] = useState('cpu');
  const [hoveredPod, setHoveredPod] = useState(null);
  const [selectedPod, setSelectedPod] = useState(null);

  const { data, podNames } = useMemo(() => parseLogs(LOG_DATA), []);

  const unit = metric === 'cpu' ? 'm' : ' GB';
  const yLabel = metric === 'cpu' ? 'CPU (millicores)' : 'Memory (GB)';

  const handleLegendClick = (payload) => {
    const podName = payload.value;
    setSelectedPod(prev => (prev === podName ? null : podName));
  };

  const getHighlightStatus = (pod) => {
    const isHovered = hoveredPod === pod;
    const isSelected = selectedPod === pod;
    const hasAnyFocus = hoveredPod !== null || selectedPod !== null;

    return {
      isFocused: isHovered || isSelected,
      shouldDim: hasAnyFocus && !(isHovered || isSelected)
    };
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans pb-20 text-slate-900">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
      `}</style>

      <div className="max-w-7xl mx-auto space-y-8 text-left">
        {/* Dashboard Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900">Galaxy Cluster Metrics</h1>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span>Report: Feb 25 • Timeline starts at {data[0]?.timestamp}</span>
              {selectedPod && (
                <>
                  <span className="h-4 w-px bg-slate-200 mx-1" />
                  <span className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md border border-blue-100 font-medium">
                    Focus: {selectedPod}
                    <button onClick={() => setSelectedPod(null)} className="hover:text-blue-900 font-bold ml-1">×</button>
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex p-1 bg-slate-100 rounded-lg shrink-0">
            <button
              onClick={() => setMetric('cpu')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                metric === 'cpu' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              CPU Load
            </button>
            <button
              onClick={() => setMetric('memory')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                metric === 'memory' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Memory Usage
            </button>
          </div>
        </div>

        {/* 1. Cumulative Cluster Load (Stacked Area) */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-800">Cumulative Cluster Load</h2>
            <p className="text-sm text-slate-500 italic">Total resource footprint summed by functional groups</p>
          </div>
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="relativeTime" stroke="#94a3b8" fontSize={11} tickMargin={10} />
                <YAxis stroke="#94a3b8" fontSize={11} tickMargin={10}>
                  <Label value={`Total ${yLabel}`} angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fill: '#64748b', fontSize: 12 }} />
                </YAxis>
                <Tooltip content={<CustomTooltip unit={unit} metric={metric} />} />
                <Legend
                  verticalAlign="top" height={130}
                  onMouseEnter={(o) => setHoveredPod(o.value)}
                  onMouseLeave={() => setHoveredPod(null)}
                  onClick={handleLegendClick}
                  wrapperStyle={{ cursor: 'pointer', paddingBottom: '30px' }}
                />
                {podNames.map((pod, index) => {
                   const { isFocused, shouldDim } = getHighlightStatus(pod);
                   return (
                    <Area
                      key={pod}
                      type="monotone"
                      dataKey={`${pod}_${metric}`}
                      name={pod}
                      stackId="1"
                      stroke={COLORS[index % COLORS.length]}
                      fill={COLORS[index % COLORS.length]}
                      fillOpacity={isFocused ? 0.9 : (shouldDim ? 0.05 : 0.6)}
                      strokeOpacity={isFocused ? 1 : (shouldDim ? 0.1 : 0.8)}
                      animationDuration={300}
                    />
                  );
                })}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2. Individual Pod Performance (Line Chart) */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-slate-800">Resource Distribution</h2>
            <p className="text-sm text-slate-500 italic">Comparing the usage levels of functional groups side-by-side</p>
          </div>
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="relativeTime" stroke="#94a3b8" fontSize={11} tickMargin={10} />
                <YAxis stroke="#94a3b8" fontSize={11} tickMargin={10}>
                  <Label value={yLabel} angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fill: '#64748b', fontSize: 12 }} />
                </YAxis>
                <Tooltip content={<CustomTooltip unit={unit} metric={metric} />} />
                <Legend
                  verticalAlign="top" height={130}
                  onMouseEnter={(o) => setHoveredPod(o.value)}
                  onMouseLeave={() => setHoveredPod(null)}
                  onClick={handleLegendClick}
                  wrapperStyle={{ cursor: 'pointer', paddingBottom: '30px' }}
                />
                {podNames.map((pod, index) => {
                  const { isFocused, shouldDim } = getHighlightStatus(pod);
                  return (
                    <Line
                      key={pod}
                      type="monotone"
                      dataKey={`${pod}_${metric}`}
                      name={pod}
                      stroke={COLORS[index % COLORS.length]}
                      strokeWidth={isFocused ? 4 : 2}
                      strokeOpacity={isFocused ? 1 : (shouldDim ? 0.1 : 0.8)}
                      dot={false}
                      activeDot={{ r: 6, strokeWidth: 0 }}
                      connectNulls
                      onMouseEnter={() => setHoveredPod(pod)}
                      onMouseLeave={() => setHoveredPod(null)}
                      animationDuration={300}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Global Cluster Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
          <StatCard title="Cluster Average" value={calculateAverage(data, metric)} unit={unit} color="emerald" />
          <StatCard title="Peak Demand" value={calculatePeak(data, metric)} unit={unit} color="rose" />
          <StatCard title="Groups Monitored" value={podNames.length} unit="active" color="blue" />
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, unit = '', color }) {
  const colorClasses = {
    blue: 'text-blue-600 bg-blue-50 border-blue-100',
    emerald: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    rose: 'text-rose-600 bg-rose-50 border-rose-100'
  };
  return (
    <div className={`bg-white p-6 rounded-2xl shadow-sm border ${colorClasses[color].split(' ')[2]}`}>
      <h3 className="text-slate-500 text-[10px] font-black uppercase tracking-[0.1em]">{title}</h3>
      <div className={`mt-2 text-3xl font-bold ${colorClasses[color].split(' ')[0]}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
        <span className="text-lg ml-1 opacity-70 font-medium lowercase">{unit}</span>
      </div>
    </div>
  );
}

function calculateAverage(data, metric) {
  if (!data.length) return 0;
  const totals = data.map(sample => sample[`total_${metric}`]);
  const avg = totals.reduce((a, b) => a + b, 0) / data.length;
  return metric === 'memory' ? parseFloat(avg.toFixed(2)) : Math.round(avg);
}

function calculatePeak(data, metric) {
  if (!data.length) return 0;
  const totals = data.map(sample => sample[`total_${metric}`]);
  const max = Math.max(...totals);
  return metric === 'memory' ? parseFloat(max.toFixed(2)) : max;
}
