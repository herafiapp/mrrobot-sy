import 'package:flutter/material.dart';

import 'api.dart';
import 'ui.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(MrRobotApp(controller: ShopController(CashierApi())));
}
