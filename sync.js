const EVENT_TYPES = {
    CREATE_OBJECT:'CREATE_OBJECT',
    DELETE_OBJECT:'DELETE_OBJECT',
    CREATE_PROPERTY:'CREATE_PROPERTY',
    SET_PROPERTY:'SET_PROPERTY',
    DELETE_PROPERTY:'DELETE_PROPERTY',

    CREATE_ARRAY:'CREATE_ARRAY',
    INSERT_ELEMENT:'INSERT_ELEMENT',
    DELETE_ELEMENT:'DELETE_ELEMENT',
    DELETE_ARRAY:'DELETE_ARRAY',
}


//resolve conflict when inserting element into an array
function isFirst(a,b) {
    //most recent wins
    if(a._timestamp > b._timestamp) return true
    if(a._seq > b._seq) return true
    return false
}

function isNewer(a,b) {
//    console.log('comparing',a,b)
    if(a.timestamp > b.timestamp) return true
    if(a.timestamp < b.timestamp) return false
    //compare seq if on the same host
    if(a.host === b.host) {
        if (a.seq > b.seq) return true
        if (a.seq < b.seq) return false
    }
    //if timestamps and seqs are same, just use the newer
    return true
}

class ObjectSyncProtocol {
    constructor(settings) {
        settings = settings || {}
        this.objs = {}
        this.listeners = []
        this.host = settings.host || this.makeGUID()
        this.waitBuffer = []
        this.historyBuffer = []
        this._seq = 0
    }
    makeGUID() {
        return Math.floor(Math.random()*100000000) + ""
    }
    nextSeq() {
        this._seq++
        return this._seq
    }

    isValidOperation(op) {
        if(!op.seq) return false
        if(op.type === EVENT_TYPES.CREATE_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return false
        }
        if(op.type === EVENT_TYPES.SET_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return false
        }
        if(op.type === EVENT_TYPES.DELETE_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return false
        }
        if(op.type === EVENT_TYPES.DELETE_OBJECT) {
            const obj = this.getObjectById(op.id)
            if(!obj) return false
        }
        if(op.type === EVENT_TYPES.INSERT_ELEMENT) {
            const array = this.getObjectById(op.array)
            if(!array) return false
        }
        if(op.type === EVENT_TYPES.DELETE_ELEMENT) {
            const array = this.getObjectById(op.array)
            if(!array) return false
        }
        return true
    }

    retryWaitBuffer() {
        // console.log("::: retrying")
        let i = 0
        while(i < this.waitBuffer.length) {
            const op = this.waitBuffer[i]
            if(this.isValidOperation(op)) {
                console.log("re-trying op",op)
                this.process(op)
                this.waitBuffer.splice(i,1)
            }
            i++
        }
    }
    process(op) {
        // console.log(`${this.getHostId()}:processing op`,op)
        if(!this.isValidOperation(op)) {
            console.log("the operation is not valid. might be in the future")
            this.waitBuffer.push(op)
            return
        }

        this.historyBuffer.push(op)

        if(op.type === EVENT_TYPES.CREATE_OBJECT) {
            return this.processCreateObject(op)
        }
        if(op.type === EVENT_TYPES.CREATE_PROPERTY) {
            return this.processCreateProperty(op)
        }
        if(op.type === EVENT_TYPES.SET_PROPERTY) {
            return this.processSetProperty(op)
        }
        if(op.type === EVENT_TYPES.DELETE_PROPERTY) {
            const obj = this.getObjectById(op.object)
            if(!obj) return console.error(`cannot delete property on object ${ob.object} that does not exist`)
            if(!obj.hasOwnProperty(op.name)) return console.error(`object doesn't have the property ${op.name}`)
            delete obj[op.name]
            this.fire(op)
            return
        }
        if(op.type === EVENT_TYPES.DELETE_OBJECT) {
            const obj = this.getObjectById(op.id)
            if(!obj) return console.error(`no such object exists with id ${op.id}`)
            delete this.objs[obj._id]
            this.fire(op)
            return
        }

        if(op.type === EVENT_TYPES.CREATE_ARRAY) {
            const arr = {
                _id: op.id,
                _type: 'array',
                _elements: []
            }
            if (this.objs[arr._id]) {
                console.warn("array already exists. don't fire or change")
                return arr._id
            }
            this.objs[arr._id] = arr
            this.fire(op)
            this.retryWaitBuffer()
            return arr._id
        }

        if(op.type === EVENT_TYPES.INSERT_ELEMENT) {
            // console.log("working on insert element")
            const arr = this.getObjectById(op.array)
            if (!arr) return console.error(`Cannot insert element into ${op.array} that does not exist`);
            //check if already in there. id p entryid and prev is the same
            if(arr._elements.some(e=>e._id === op.entryid && e._prev === op.prev)) {
                console.warn("already processed this insertion. don't fire or change")
                return
            }
            // console.log("inserting",op.value,'after',op.prev,'into',arr,'with id',op.entryid)

            const elem = {
                _id:op.entryid,
                _value:op.value,
                _prev:op.prev,
                _timestamp:op.timestamp,
                _seq:op.seq,
                _host:op.host,
                _tombstone:false,
            }
            //calculate the index of the prev
            const index = arr._elements.findIndex(e => e._id === op.prev)
            // console.log("index of prev is",index)

            const curr = arr._elements[index+1]
            //three forms of insert
            if(curr && curr._prev === elem._prev) {
                if(isFirst(elem,curr)) {
                    arr._elements.splice(index+1,0,elem)
                } else {
                    arr._elements.splice(index+2,0,elem)
                }
            } else {
                arr._elements.splice(index+1,0,elem)
            }
            // console.log("final array is",arr)
            this.fire(op)
            return
        }

        if(op.type === EVENT_TYPES.DELETE_ELEMENT) {
            // console.log("processing",op)
            const arr = this.getObjectById(op.array)
            const elem = arr._elements.find(elem => elem._id === op.entry)
            elem._tombstone = true
            // console.log("final array is",arr)
            this.fire(op)
            return op.value
        }


        console.error(`CANNOT process operation of type ${op.type}`)
    }

    processCreateObject(op) {
        const obj = {
            _id:op.id,
            _type:'object',
        }
        if(this.objs[obj._id]) {
            console.log(`object ${obj._id} already exists. don't fire or change`)
            return obj._id
        }
        this.objs[obj._id] = obj

        if(op.defaults) {
            Object.keys(op.defaults).forEach(key =>{
                obj[key] = {
                    value: op.defaults[key],
                    timestamp: op.timestamp,
                    host: op.host,
                    seq: op.seq
                }
            })
            console.log("need to apply default props")
        }

        this.fire(op)
        this.retryWaitBuffer()
        return obj._id
    }
    processCreateProperty(op) {
        const obj = this.getObjectById(op.object)
        if(!obj) return console.error(`Cannot create property ${op.name} on object ${op.object} that does not exist`)
        if(obj[op.name]) return console.log(`property already exists ${op.name}. don't fire or change`)
        obj[op.name] = {
            value: op.value,
            timestamp: op.timestamp,
            host: op.host,
            seq: op.seq,
        }
        this.fire(op)
    }
    processSetProperty(op) {
        const obj = this.getObjectById(op.object)
        if(!obj) return console.error(`Cannot set property ${op.name} on object ${op.object} that does not exist`)

        if(op.props) {
            console.log("doing a multi-prop set")
            let changed = false
            Object.keys(op.props).forEach(key => {
                const old_prop = obj[key]
                const new_prop = {
                    value: op.props[key],
                    timestamp: op.timestamp,
                    host: op.host,
                    seq: op.seq,
                }
                if(isNewer(new_prop,old_prop)) {
                    obj[key] = new_prop
                    changed = true
                }
            })
            if(changed) this.fire(op)
            return
        }

        if(obj[op.name] && obj[op.name].value === op.value)
            return console.warn("property already has this value, don't fire or change")
        if(!this.hasPropertyValue(op.object,op.name))
            return console.error("trying to set a property that doesn't exist")

        const old_prop = obj[op.name]
        const new_prop =  {
            value: op.value,
            timestamp: op.timestamp,
            host: op.host,
            seq: op.seq,
        }
        //only update and fire if new
        if(isNewer(new_prop,old_prop)) {
            obj[op.name] = new_prop
            this.fire(op)
        }
    }

    getObjectById(objid) {
        return this.objs[objid]
    }

    hasObject(objid) {
        return typeof this.objs[objid] !== 'undefined'
    }

    getArrayLength(arrid) {
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot get array length for array ${arrid} that does not exist`);
        let len = 0
        arr._elements.forEach(el => {
            if(el._tombstone === false) len++
        })
        return len
    }
    getElementAt(arrid,index) {
        const arr = this.getObjectById(arrid)
        if (!arr) return console.error(`Cannot get element from array ${arrid} that does not exist`);
        // console.log('real array length',arr._elements.length)
        // console.log("logical array length",this.getArrayLength(arrid))
        let count = 0
        for(let i=0; i<arr._elements.length; i++) {
            const elem = arr._elements[i]
            if(elem._tombstone) continue
            // console.log("checking",index,count,elem)
            if(count === index) return elem._value
            count++
        }
        return console.error(`cannot find element for array ${arrid} at index ${index}`)
    }

    getHostId() {
        return this.host
    }

    onChange(cb) {
        this.listeners.push(cb)
    }
    offChange(cb) {
        const n = this.listeners.indexOf(cb)
        if(n >= 0) this.listeners.splice(n,1)
    }
    fire(event) {
        this.listeners.forEach(cb => cb(event))
    }

    getObjectByProperty(key,value) {
        for(let id in this.objs) {
            const obj = this.objs[id]
            if(obj[key] && obj[key].value === value) return obj._id
        }
        return null
    }

    getPropertiesForObject(objid) {
        const obj = this.getObjectById(objid)
        if(!obj) return console.error(`cannot get properties for object ${objid} that does not exist not exist`)
        return Object.keys(obj)
            .filter(key => key !== '_id')
            .filter(key => key !== '_type')
    }
    getPropertyValue(objid, key) {
        const obj = this.getObjectById(objid)
        if(!obj) return console.error(`cannot get property value for object ${objid} that does not exist not exist`)
        if(!obj[key]) return console.error(`cannot get property value for property '${key}' that does not exist on object`)
        return obj[key].value
    }
    hasPropertyValue(objid,key) {
        const obj = this.getObjectById(objid)
        if(obj) return obj.hasOwnProperty(key)
        return false
    }

    getHistory() {
        return this.historyBuffer.slice()
    }

    dumpGraph() {
        const graph = {}
        Object.keys(this.objs).forEach(key => {
            const obj = this.objs[key]
            let id = obj._id
            if(obj.id) id = obj.id.value
            graph[id] = {}

            if(obj._type === 'array'){
                graph[id] = []
                obj._elements.forEach((el=>{
                    // console.log("looking at element",el)
                    if(el._tombstone === false) graph[id].push(el._value)
                }))
                return;
            }

            Object.keys(obj).forEach(key => {
                if(key === '_id') {
                    if(obj.id) {
                        graph[id]['id'] = obj.id.value
                        return
                    } else {
                        graph[id]['id'] = obj[key]
                        return
                    }
                }
                if(key === '_type') return
                graph[id][key] = obj[key].value
            })
        })
        return graph
    }
}

class CommandGenerator {
    constructor(graph) {
        this.graph = graph
    }
    createOp(type) {
        return {
            type: type,
            host: this.graph.getHostId(),
            timestamp: Date.now(),
            uuid: this.graph.makeGUID(),
            seq: this.graph.nextSeq(),
        }
    }
    createObject(defaults) {
        const op = this.createOp(EVENT_TYPES.CREATE_OBJECT)
        op.id = this.graph.makeGUID()
        if(defaults) op.defaults = defaults
        return op
    }
    createProperty(id,name,value){
        const op = this.createOp(EVENT_TYPES.CREATE_PROPERTY)
        op.object = id
        op.name = name
        op.value = value
        return op
    }
    setProperty(id, name, value) {
        const op = this.createOp(EVENT_TYPES.SET_PROPERTY)
        op.object = id
        op.name = name
        op.value = value
        return op
    }
    setProperties(id, props) {
        const op = this.createOp(EVENT_TYPES.SET_PROPERTY)
        op.object = id
        op.props = props
        return op
    }
    deleteProperty(id,name) {
        const op = this.createOp(EVENT_TYPES.DELETE_PROPERTY)
        op.object = id
        op.name = name
        return op
    }
    deleteObject(id) {
        const op = this.createOp(EVENT_TYPES.DELETE_OBJECT)
        op.id = id
        return op
    }
    createArray() {
        const op = this.createOp(EVENT_TYPES.CREATE_ARRAY)
        op.id = this.graph.makeGUID()
        return op
    }
    insertElement(arrid, index, elementid) {
        const op = this.createOp(EVENT_TYPES.INSERT_ELEMENT)
        op.array = arrid
        op.value = elementid
        op.entryid = this.graph.makeGUID()
        op.prev = -1
        if(index > 0) {
            op.prev = this.graph.getObjectById(arrid)._elements[index - 1]._id
        }
        return op
    }
    insertAfter(arrid, targetid, objid) {
        const op = this.createOp(EVENT_TYPES.INSERT_ELEMENT)
        op.array = arrid
        op.value = objid
        op.entryid = this.graph.makeGUID()
        op.prev = -1
        // console.log("inserting after target",targetid)
        if(targetid) {
            const arr = this.graph.getObjectById(arrid)
            op.prev = arr._elements.find(e => e._value === targetid && e._tombstone === false)._id
        }
        return op
    }
    removeElementByEntryId(arrid,entryid) {
        const op = this.createOp(EVENT_TYPES.DELETE_ELEMENT)
        op.array = arrid
        op.entry = entryid
        return op
    }
    removeElement(arrid, index) {
        const op = this.createOp(EVENT_TYPES.DELETE_ELEMENT)
        op.array = arrid
        const arr = this.graph.getObjectById(arrid)
        let entry = null
        let count = 0
        let n = 0
        while(true) {
            entry = arr._elements[n]
            n++
            if(entry._tombstone === true) {
                console.log("deleted skip it")
                continue
            }

            if(count === index) {
                console.log("found it")
                break
            }
            count++
        }

        op.entry = entry._id
        op.value = entry._value
        return op
    }
}
class DocGraph {
    constructor(settings) {
        this.graph = new ObjectSyncProtocol(settings)
        this.commands = new CommandGenerator(this.graph,settings)
    }

    onChange(cb) {
        return this.graph.onChange(cb)
    }
    offChange(cb) {
        return this.graph.offChange(cb)
    }

    process(op) {
        return this.graph.process(op)
    }

    getObjectById(id) {
        return this.graph.getObjectById(id)
    }

    getObjectByProperty(key, value) {
        return this.graph.getObjectByProperty(key, value)
    }

    getPropertyValue(objid, key) {
        return this.graph.getPropertyValue(objid, key)
    }

    hasPropertyValue(objid, key) {
        return this.graph.hasPropertyValue(objid, key)
    }

    getPropertiesForObject(objid) {
        return this.graph.getPropertiesForObject(objid)
    }
    getArrayLength(id) {
        return this.graph.getArrayLength(id)
    }
    getElementAt(id,index) {
        return this.graph.getElementAt(id,index)
    }
    getHostId() {
        return this.graph.getHostId()
    }
    hasObject(objid) {
        return this.graph.hasObject(objid)
    }
    makeGUID() {
        return this.graph.makeGUID()
    }
    nextSeq() {
        return this.graph.nextSeq()
    }

    dumpGraph() {
        return this.graph.dumpGraph()
    }

    createObject(defaults) {
        const op = this.commands.createObject(defaults)
        return this.graph.process(op)
    }
    createProperty(id, name, value) {
        const op = this.commands.createProperty(id,name,value)
        return this.graph.process(op)
    }

    setProperty(id, name, value) {
        const op = this.commands.setProperty(id,name,value)
        return this.graph.process(op)
    }

    deleteProperty(id, name) {
        const op = this.commands.deleteProperty(id,name)
        return this.graph.process(op)
    }

    deleteObject(id) {
        const op = this.commands.deleteObject(id)
        return this.graph.process(op)
    }

    createArray() {
        const op = this.commands.createArray()
        return this.graph.process(op)
    }

    insertElement(arrid, index, elementid) {
        const op = this.commands.insertElement(arrid,index,elementid)
        return this.graph.process(op)
    }
    insertAfter(arrid, targetid, objid) {
        const op = this.commands.insertAfter(arrid,targetid,objid)
        return this.graph.process(op)
    }
    removeElement(arrid, index) {
        const op = this.commands.removeElement(arrid,index)
        return this.graph.process(op)
    }
    getHistory() {
        return this.graph.getHistory()
    }

}

class HistoryView {
    constructor(graph) {
        this.history = []
        this.listeners = []
        graph.onChange((e)=>{
            const obj = { type:e.type, host: e.host, timestamp: e.timestamp}
            if(e.type === EVENT_TYPES.CREATE_PROPERTY || e.type === EVENT_TYPES.SET_PROPERTY) {
                obj.name = e.name
                obj.value = e.value
            }
            this.history.push(obj)
            this.fire(obj)
        })
    }
    onChange(cb) {
        this.listeners.push(cb)
    }
    fire(obj) {
        this.listeners.forEach(cb => cb(obj))
    }
    dump() {
        return this.history
    }
}

module.exports.ObjectSyncProtocol = ObjectSyncProtocol
module.exports.DocGraph = DocGraph
module.exports.HistoryView = HistoryView
module.exports.CommandGenerator = CommandGenerator
Object.keys(EVENT_TYPES).forEach(key => {
    module.exports[key] = EVENT_TYPES[key]
})
