/**
 * 公式数据类
 * @author linzhiliang
 * @since 2020-09-25
 */

module game {
    export class FormulaModel extends BaseModel {

        public data: IModelData;

        public onInit() {
            this.data = {
                regs: [
                    /[0-9]/,//纯数解析正则
                    /[0-9\.]+/,//数值解析正则
                    /[a-z]|[A-Z]/,//英文字母解析正则
                    /([a-z]|[A-Z])+[0-9]*/,//变量解析正则
                    /[^\(\)]+/,//开始结束标签外字符解析正则
                ],
                priorityMap: { '+': 0, '-': 0, '*': 1, '/': 1, '%': 1, '^': 2 },
                errors: [
                    //公式中的变量在配置中不存在
                    `parameter [$[1]] in formula [$[0]] does not include in list [$[2]]`,
                    //公式中的某表达式存在非法的结束标签
                    `expression [$[1]] in formula [$[0]] get an wrong end tag at position $[2]`,
                    //公式中的某表达式缺少结束标签
                    `expression [$[1]] in formula [$[0]] lack of end tag`,
                    //公式中的某表达式在一对开始结束标签中缺少表达过程
                    `expression [$[1]] in formula [$[0]] lack of expression in current pair of tags at postion $[2]`,
                    //公式中出现非法字符
                    `expression [$[1]] in formula [$[0]] get an illegal string [$[2]] at postion $[3]`
                ],
                formulaPool: {},
                resultPool: {},
                cacheResult: true
            }
        }

        /** 解析出计算结构 */
        private parse(formula: string, parameters: string[]): IFormulaStruct {
            const self = this;
            const { regs, priorityMap } = self.data;

            const result: IFormulaStruct = { cacs: [], eles: [] };
            const buffers: Array<IParseBuffer> = [];

            let buffer: IParseBuffer = [formula, result, -1];

            let expression: string;//表达式
            let struct: IFormulaStruct;//计算结构
            let index: number;
            let priority: number;//计算优先级
            let parent: IParseBuffer;//父级过程结构
            let cacs: string[];//运算符列表
            let eles: IFormulaEle[];//计算元素列表
            let length: number;//表达式长度
            let str: string;
            let strs: string;
            let argIndex: number;//变量顺序
            let prioDiff: number;//计算优先级差
            let depth: number;//括号嵌套深度
            let position: number;
            let matcher: RegExpMatchArray;

            loop: while (true) {
                [expression, struct, index, priority, parent] = buffer;
                length = expression.length;
                cacs = struct.cacs;
                eles = struct.eles;

                while (++index < length) {
                    str = expression[index];

                    //解析数值字符串
                    if (regs[0].test(str)) {
                        strs = expression.slice(index);
                        strs = strs.match(regs[1])[0];

                        eles.push({ type: 1, value: +strs });
                        index += strs.length - 1;
                    }
                    //解析变量字符串
                    else if (regs[2].test(str)) {
                        strs = expression.slice(index);
                        strs = strs.match(regs[3])[0];
                        argIndex = parameters.indexOf(strs);

                        if (argIndex > -1) {
                            eles.push({ type: 2, argIndex });
                            index += strs.length - 1;
                        }
                        else {
                            self.error(0, formula, strs, parameters + '');
                            break loop;
                        }
                    }
                    //解析内嵌计算结构
                    else if (str === '(') {
                        depth = 1;
                        position = index;

                        while (depth !== 0 && position < length) {
                            switch (expression[++position]) {
                                case '(':
                                    depth++;
                                    break;
                                case ')':
                                    depth--;
                                    break;
                                default:
                                    strs = expression.slice(position);
                                    matcher = strs.match(regs[4]);

                                    if (matcher !== null) {
                                        position += matcher[0].length - 1;
                                        break;
                                    }
                                    else {
                                        self.error(3, formula, expression, position - index + '');
                                        break loop;
                                    }
                            }
                        }

                        if (depth === 0) {
                            struct = { cacs: [], eles: [] };

                            eles.push({ type: 3, struct });
                            buffers.push([expression.slice(index + 1, position), struct, -1])
                            index = position;
                        }
                        else {
                            self.error(2, formula, expression);
                            break loop;
                        }
                    }
                    else if (str === ')') {
                        self.error(1, formula, expression, index + '');
                        break loop;
                    }
                    //解析遇到当前运算符时的计算过程
                    else if (str in priorityMap) {
                        prioDiff = priority !== void 0 ? priorityMap[str] - priority : 0;
                        priority = priorityMap[str];

                        //优先级降低
                        if (prioDiff < 0) {
                            if (parent !== void 0 && parent[3] >= priority) {
                                parent[1].cacs.push(str);
                                parent[3] = priority;
                                break;
                            }
                            else {
                                cacs.push(str);
                                buffer[3] = priority;
                            }
                        }
                        //优先级不变
                        else if (prioDiff === 0) {
                            cacs.push(str);
                            buffer[3] = priority;
                        }
                        //优先级提高
                        else {
                            struct = { cacs: [str], eles: [eles.pop()] };

                            buffer[2] = index;
                            eles.push({ type: 3, struct });
                            buffer = [expression, struct, index, priority, buffer];
                            continue loop;
                        }
                    }
                    else {
                        self.error(4, formula, expression, str, index + '');
                        break loop;
                    }
                }

                //若当前解析过程关联计算优先级的父级过程，则回退到父级过程并继续解析
                if (parent !== void 0) {
                    buffer = parent;
                    buffer[2] = index;
                }
                //若解析队列中仍有解析过程未完成，则取出并完成解析
                else if (buffers.length > 0) {
                    buffer = buffers.pop();
                }
                else {
                    return result;
                }
            }

            //若到此，公式的解析过程中遇到了解析异常，则返回一个包含无效值的计算结构
            return {
                cacs: [],
                eles: [{ type: 1, value: NaN }]
            };
        }

        /** 获取计算结构 */
        private getStruct(formulaId: number): IFormulaStruct {
            const self = this;
            const pool = self.data.formulaPool;
            const cfg = P.config.formula[formulaId];

            if (pool[formulaId] === void 0) {
                pool[formulaId] = self.parse(cfg.expression, cfg.parameter);
            }

            return pool[formulaId];
        }

        /** 报告解析异常 */
        private error(id: number, ...args: string[]) {
            let error = this.data.errors[id];

            for (let i = 0, length = args.length; i < length; i++) {
                error = error.replace(new RegExp(`\\$\\[${i}\\]`, 'g'), args[i]);
            }

            H.Log.error(error);
        }

        /** 根据配置公式计算值 */
        public caculate(formulaId: number, ...args: Array<struct.NumberLike>) {
            const self = this;
            const { cacheResult, resultPool } = self.data;
            const struct = self.getStruct(formulaId);//计算结构
            const buffers = [<ICaculateBuffer>[struct.cacs, struct.eles, BigNumber.sum(0), -1, void 0]];//计算队列
            const argsKey: string = args.join('_');

            let buffer: ICaculateBuffer;//计算过程结构
            let mStruct: IFormulaStruct;//中间计算结构
            let cacs: Array<string>;
            let eles: Array<IFormulaEle>;
            let midValue: BigNumber;//中介值
            let value: BigNumber;//计算值
            let caculater: string;//运算符
            let element: IFormulaEle;//计算元素
            let index: number;
            let cache: BigNumber;//中间计算过程缓存值

            if (cacheResult && resultPool[formulaId] === void 0) {
                resultPool[formulaId] = {};
            }
            if (cacheResult && resultPool[formulaId][argsKey] !== void 0) {
                value = BigNumber.sum(resultPool[formulaId][argsKey]);
            }
            else {
                loop: while (buffers.length > 0) {
                    buffer = buffers[buffers.length - 1];
                    [cacs, eles, value, index, cache] = buffer;
                    cacs = ['+'].concat(cacs);

                    while (++index < cacs.length) {
                        caculater = cacs[index];
                        element = eles[index];

                        //若中间计算过程缓存值为空，则代表当前计算过程如常进行
                        if (cache === void 0) {
                            //获取中间值
                            switch (element.type) {
                                case 1:
                                    midValue = BigNumber.sum(element.value);
                                    break;
                                case 2:
                                    midValue = BigNumber.sum(args[element.argIndex] +'');
                                    break;
                                //遇到中间计算结构
                                case 3:
                                    mStruct = element.struct;

                                    buffer[2] = value;//缓存当前计算值
                                    buffer[3] = index - 1;//缓存计算序号
                                    buffers.push([mStruct.cacs, mStruct.eles, BigNumber.sum(0), -1, void 0]);//将新的计算过程加入计算队列
                                    continue loop;//跳过当前计算过程，计算刚遇到的中间计算结构
                            }
                        }
                        //若计算过程缓存值不为空，则代表刚结束上一个中间计算过程，并重新回到当前计算过程
                        else {
                            midValue = cache;//获取中间值
                            cache = buffer[4] = void 0;
                        }

                        switch (caculater) {
                            case '+':
                                value = value.plus(midValue);
                                break;
                            case '-':
                                value = value.minus(midValue);
                                break;
                            case '*':
                                value = value.times(midValue);
                                break;
                            case '/':
                                value = value.div(midValue);
                                break;
                            //取余
                            case '%':
                                value = value.mod(midValue);
                                break;
                            //幂乘
                            case '^':
                                value = midValue.isInteger() ? value.pow(midValue) : BigNumber.sum(Math.pow(value.toNumber(), midValue.toNumber()));
                                break;
                        }
                    }

                    //若计算队列中仅有一个计算过程，则到此已完成所有计算过程
                    if (buffers.length === 1) {
                        break;
                    }
                    //若计算队列中不止一个计算过程，则缓存当前计算结果为中间过程缓存值，并退到上一个计算过程
                    else {
                        buffers[--buffers.length - 1][4] = value;
                    }
                }

                if (cacheResult) {
                    resultPool[formulaId][argsKey] = value + '';
                }
            }

            return value;
        }

    }

    interface IModelData {
        regs: ReadonlyArray<RegExp>;//字符解析正则表
        errors: string[];//异常列表
        priorityMap: egret.MapLike<number>;
        formulaPool: egret.MapLike<IFormulaStruct>;//计算结构缓存池
        resultPool: egret.MapLike<egret.MapLike<string>>;//计算结果缓存池
        cacheResult: boolean;//是否缓存计算结果
    }

    //计算元素
    interface IFormulaEle {
        type: 1 | 2 | 3; //1.数值 2.变量 3.结构体
        value?: number;//数值
        argIndex?: number;//变量序号
        struct?: IFormulaStruct;//计算结构
    }

    //计算结构
    interface IFormulaStruct {
        cacs: string[];//运算符列表
        eles: IFormulaEle[];//计算元素列表
    }

    //解析过程结构
    interface IParseBuffer extends Array<any> {
        0: string;//表达式
        1: IFormulaStruct;//计算结构
        2: number;//当前读取序号
        3?: number;//计算优先级
        4?: IParseBuffer;//父级过程结构
    }

    //计算过程结构
    interface ICaculateBuffer extends Array<any> {
        0: Array<string>;//运算符列表
        1: Array<IFormulaEle>;//计算元素列表
        2: BigNumber;//当前计算值
        3: number;
        4: BigNumber;//子级计算值
    }

}